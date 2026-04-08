import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { AutomationJobKind, AutomationJobStatus, MessageRole, MessageType } from "@prisma/client";
import {
  EffectiveBucket,
  EffectiveTier,
  FollowupTimingKey,
  resolveFollowupView,
  timingKeyToNextFollowupAt,
} from "@/lib/followup-rules";

type DbMessage = {
  id: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION";
  japaneseText: string;
  chineseText: string | null;
  sentAt: Date;
};

type HelperTranslation = {
  messageId?: string;
  chinese?: string;
};

type HelperResult = {
  translations?: HelperTranslation[];
  customerInfo?: string;
  currentStrategy?: string;
  shouldGenerateReplies?: boolean;
  autoReason?: string;
  followupTier?: EffectiveTier;
  followupReason?: string;
  followupTimingKey?: FollowupTimingKey;
};

const OPERATOR_PRESENCE_ID = "PRIMARY";
const ACTIVE_WINDOW_MS = 5_000;
const ONLINE_WINDOW_MS = 10_000;
const OFFLINE_WINDOW_MS = 40_000;

function cleanModelJson(content: string) {
  return content.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function extractJsonObject(content: string) {
  const cleaned = cleanModelJson(content);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`模型未返回合法 JSON：${cleaned}`);
  }

  return cleaned.slice(start, end + 1);
}

function parseModelJson<T>(content: string) {
  return JSON.parse(extractJsonObject(content)) as T;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTier(value: unknown): EffectiveTier | null {
  return value === "A" || value === "B" || value === "C" ? value : null;
}

function normalizeTimingKey(value: unknown): FollowupTimingKey | null {
  return value === "24H" || value === "2D" || value === "5D" || value === "7D" || value === "14D" || value === "NONE"
    ? value
    : null;
}

function shortenForContext(text: string, max = 700) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;

  const head = Math.max(260, Math.floor(max * 0.65));
  const tail = Math.max(110, max - head - 30);
  return `${normalized.slice(0, head)} …… ${normalized.slice(-tail)}`;
}

function formatConversation(messages: DbMessage[]) {
  return messages
    .map((msg, index) => {
      const who = msg.role === "CUSTOMER" ? "顾客" : "我方";
      const typeText = msg.type === "IMAGE" ? "图片消息" : "文字消息";
      const japanese = shortenForContext(msg.japaneseText || "", msg.role === "OPERATOR" ? 900 : 600);
      const chinese = msg.chineseText ? shortenForContext(msg.chineseText, 220) : "";

      return `${index + 1}. ${who}\n消息类型：${typeText}\n日语原文：${japanese}\n中文意思：${chinese}`;
    })
    .join("\n\n");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDebounceMs(customerId: string) {
  const presence = await prisma.operatorPresence.findUnique({
    where: { id: OPERATOR_PRESENCE_ID },
  });

  if (!presence) return OFFLINE_WINDOW_MS;

  const idleMs = Date.now() - presence.lastSeenAt.getTime();

  if (idleMs <= 20_000 && presence.selectedCustomerId === customerId) {
    return ACTIVE_WINDOW_MS;
  }

  if (idleMs <= 180_000) {
    return ONLINE_WINDOW_MS;
  }

  return OFFLINE_WINDOW_MS;
}

function collectPendingCustomerBurst(messagesAsc: DbMessage[], targetMessageId: string) {
  const pending: DbMessage[] = [];

  for (let i = messagesAsc.length - 1; i >= 0; i -= 1) {
    const msg = messagesAsc[i];
    if (msg.role !== "CUSTOMER") break;
    if (msg.type !== "TEXT") break;
    pending.unshift(msg);
    if (msg.id !== targetMessageId && pending.length >= 6) break;
  }

  return pending;
}

async function runHelperBatch(options: {
  customer: {
    id: string;
    remarkName: string | null;
    originalName: string;
    stage: string;
    isVip: boolean;
    aiCustomerInfo: string | null;
    aiCurrentStrategy: string | null;
    unreadCount: number;
    followupBucket: EffectiveBucket;
    followupTier: EffectiveTier;
    followupReason: string;
    nextFollowupAt: Date | null;
    tags: string[];
  };
  conversation: DbMessage[];
  pendingBurst: DbMessage[];
}) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.HELPER_MODEL;

  if (!apiKey || !baseUrl || !backupBaseUrl || !model) {
    throw new Error("副模型环境变量缺失");
  }

  const conversationText = formatConversation(options.conversation);
  const pendingText = options.pendingBurst
    .map((msg, index) => `${index + 1}. messageId=${msg.id}\n日语：${shortenForContext(msg.japaneseText, 500)}`)
    .join("\n\n");

  const prompt = `
你是日本 LINE 私域玄学销售工作台的副模型总控助手。
你的任务是：对“当前这一个顾客”的最新一波入站消息，一次性做五件事：
1. 给 pending 消息做日中翻译；
2. 用极短中文更新客户信息摘要；
3. 用极短中文更新当前思路摘要；
4. 保守判断：这一波消息是否值得自动触发主模型生成建议回复；
5. 顺手给跟进中心输出：A/B/C、跟进原因、默认跟进档位。

不可违反的规则：
- 你只处理当前这一位顾客，绝不能带入任何其他顾客的信息、情绪、阶段、案例。
- 你不能写长篇鉴定文。
- 平台 AI 的职责是 LINE 短聊承接、推进成交、处理异议。
- 默认要保守：没有明显销售价值时，不要建议自动触发主模型。
- 如果消息只是谢谢、收到、嗯嗯、轻礼貌回应、没有新信息量，shouldGenerateReplies 必须偏 false。
- 跟进中心的 bucket 不需要你判断，系统会自己根据 VIP 信号决定。
- A/B/C 是“当前投入等级”，不是永久身份；判断要保守、要动态。
- followupTimingKey 只是默认档位，不是终局时间。可选：24H / 2D / 5D / 7D / 14D / NONE

自动触发主模型建议的典型场景：
1) 顾客对免费/首单/后续长文后的第一波实质反馈；
2) 顾客开始明显追问更深层结果、原因、下一步；
3) 顾客有明显异议（怕被骗、怕没用、预算犹豫、想白嫖、其实不急、怕后续一直加钱）；
4) 顾客出现新变化、新节点、明确行动问题。

输出严格 JSON：
{
  "translations": [{"messageId":"...","chinese":"..."}],
  "customerInfo": "...",
  "currentStrategy": "...",
  "shouldGenerateReplies": true,
  "autoReason": "...",
  "followupTier": "A",
  "followupReason": "...",
  "followupTimingKey": "24H"
}

字段要求：
- translations：只翻译本次 pending 消息，逐条对应 messageId。
- customerInfo：1-2句中文，50字内。
- currentStrategy：1-2句中文，65字内。
- shouldGenerateReplies：布尔值，务必保守。
- autoReason：一句短中文，说明为什么需要或不需要自动触发。
- followupReason：一句短中文，18字内。
- 只输出 JSON，不要其他解释。

当前顾客：
- customerId：${options.customer.id}
- 备注名：${options.customer.remarkName || "无"}
- 原始昵称：${options.customer.originalName}
- 系统阶段：${options.customer.stage}
- 是否 VIP：${options.customer.isVip ? "是" : "否"}
- 当前标签：${options.customer.tags.join("、") || "无"}
- 旧客户信息摘要：${options.customer.aiCustomerInfo || "无"}
- 旧当前思路摘要：${options.customer.aiCurrentStrategy || "无"}
- 当前跟进中心默认状态：
  - bucket：${options.customer.followupBucket}
  - tier：${options.customer.followupTier}
  - reason：${options.customer.followupReason}
  - nextFollowupAt：${options.customer.nextFollowupAt ? options.customer.nextFollowupAt.toISOString() : "无"}

这次需要处理的 pending 消息：
${pendingText}

完整聊天上下文：
${conversationText}
`;

  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content:
          "你是一个保守、可靠的私域销售副模型总控助手。你只处理当前给定的这一位顾客，只输出合法 JSON。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
  };

  async function requestOnce(url: string) {
    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${text}`);
    }

    return JSON.parse(text);
  }

  try {
    const data = await requestOnce(baseUrl);
    return parseModelJson<HelperResult>(data?.choices?.[0]?.message?.content || "");
  } catch {
    const data = await requestOnce(backupBaseUrl);
    return parseModelJson<HelperResult>(data?.choices?.[0]?.message?.content || "");
  }
}

function isLongOperatorReading(message?: DbMessage | null) {
  if (!message) return false;
  if (message.role !== "OPERATOR") return false;
  if (message.type !== "TEXT") return false;
  return message.japaneseText.trim().length >= 1000;
}

export async function runInboundAutomation(options: {
  customerId: string;
  targetMessageId: string;
  internalBaseUrl: string;
}) {
  const { customerId, targetMessageId, internalBaseUrl } = options;

  const existingJob = await prisma.automationJob.findUnique({
    where: {
      customerId_targetMessageId_kind: {
        customerId,
        targetMessageId,
        kind: AutomationJobKind.INBOUND_WORKFLOW,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (existingJob) {
    return;
  }

  await prisma.automationJob.create({
    data: {
      customerId,
      targetMessageId,
      kind: AutomationJobKind.INBOUND_WORKFLOW,
      status: AutomationJobStatus.PENDING,
    },
  });

  const debounceMs = await getDebounceMs(customerId);

  await prisma.automationJob.update({
    where: {
      customerId_targetMessageId_kind: {
        customerId,
        targetMessageId,
        kind: AutomationJobKind.INBOUND_WORKFLOW,
      },
    },
    data: {
      scheduledFor: new Date(Date.now() + debounceMs),
    },
  });

  await sleep(debounceMs);

  const claimCount = await prisma.automationJob.updateMany({
    where: {
      customerId,
      targetMessageId,
      kind: AutomationJobKind.INBOUND_WORKFLOW,
      status: AutomationJobStatus.PENDING,
    },
    data: {
      status: AutomationJobStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  if (claimCount.count === 0) {
    return;
  }

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        tags: {
          include: { tag: true },
        },
        messages: {
          orderBy: {
            sentAt: "desc",
          },
          take: 120,
        },
        replyDraftSets: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!customer) {
      throw new Error("客户不存在");
    }

    const recentDesc = customer.messages as DbMessage[];
    const messagesAsc = [...recentDesc].reverse();
    const latestCustomerText = recentDesc.find(
      (msg) => msg.role === MessageRole.CUSTOMER && msg.type === MessageType.TEXT
    );

    if (!latestCustomerText || latestCustomerText.id !== targetMessageId) {
      await prisma.automationJob.update({
        where: {
          customerId_targetMessageId_kind: {
            customerId,
            targetMessageId,
            kind: AutomationJobKind.INBOUND_WORKFLOW,
          },
        },
        data: {
          status: AutomationJobStatus.SKIPPED,
          finishedAt: new Date(),
          lastError: "已有更新消息，旧任务跳过",
        },
      });
      return;
    }

    const tagNames = customer.tags.map((item) => item.tag.name);
    const followupCurrent = resolveFollowupView({
      isVip: customer.isVip,
      remarkName: customer.remarkName,
      tags: tagNames,
      stage: String(customer.stage),
      unreadCount: customer.unreadCount,
      followupBucket: customer.followupBucket as EffectiveBucket | null,
      followupTier: customer.followupTier as EffectiveTier | null,
      followupState: customer.followupState,
      followupReason: customer.followupReason,
      nextFollowupAt: customer.nextFollowupAt,
      lastMessageAt: customer.lastMessageAt,
      lastInboundMessageAt: customer.lastInboundMessageAt,
      lastOutboundMessageAt: customer.lastOutboundMessageAt,
    });

    const pendingBurst = collectPendingCustomerBurst(messagesAsc, targetMessageId).filter(
      (msg) => !msg.chineseText
    );

    const latestOperatorText = [...messagesAsc]
      .reverse()
      .find((msg) => msg.role === MessageRole.OPERATOR && msg.type === MessageType.TEXT) || null;

    const helper = await runHelperBatch({
      customer: {
        id: customer.id,
        remarkName: customer.remarkName,
        originalName: customer.originalName,
        stage: String(customer.stage),
        isVip: customer.isVip,
        aiCustomerInfo: customer.aiCustomerInfo,
        aiCurrentStrategy: customer.aiCurrentStrategy,
        unreadCount: customer.unreadCount,
        followupBucket: followupCurrent.bucket,
        followupTier: followupCurrent.tier,
        followupReason: followupCurrent.reason,
        nextFollowupAt: followupCurrent.nextFollowupAt,
        tags: tagNames,
      },
      conversation: messagesAsc,
      pendingBurst,
    });

    const translations = Array.isArray(helper.translations) ? helper.translations : [];

    for (const item of translations) {
      const messageId = normalizeText(item.messageId);
      const chinese = normalizeText(item.chinese);
      if (!messageId || !chinese) continue;

      await prisma.message.updateMany({
        where: {
          id: messageId,
          customerId,
          role: MessageRole.CUSTOMER,
        },
        data: {
          chineseText: chinese,
        },
      });
    }

    const followupTier = normalizeTier(helper.followupTier) || followupCurrent.tier;
    const followupReason = normalizeText(helper.followupReason) || followupCurrent.reason;
    const followupTimingKey = normalizeTimingKey(helper.followupTimingKey);
    const nextFollowupAt =
      followupTimingKey && followupTimingKey !== "NONE"
        ? timingKeyToNextFollowupAt(followupTimingKey, customer.lastInboundMessageAt || customer.lastMessageAt || new Date())
        : followupTimingKey === "NONE"
        ? null
        : followupCurrent.nextFollowupAt;

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        aiCustomerInfo: normalizeText(helper.customerInfo) || customer.aiCustomerInfo,
        aiCurrentStrategy: normalizeText(helper.currentStrategy) || customer.aiCurrentStrategy,
        aiLastAnalyzedAt: new Date(),
        followupTier,
        followupReason,
        nextFollowupAt,
        followupUpdatedAt: new Date(),
        followupState: customer.followupState === "PAUSED" ? "PAUSED" : "ACTIVE",
      },
    });

    const existingDraft = customer.replyDraftSets[0] ?? null;
    const hasActiveDraftForTarget =
      !!existingDraft &&
      existingDraft.targetCustomerMessageId === targetMessageId &&
      !existingDraft.selectedVariant;

    const noOperatorResponseYet = !latestOperatorText;
    const afterLongOperatorReading = isLongOperatorReading(latestOperatorText);
    const helperWantsGenerate = helper.shouldGenerateReplies === true;

    const shouldGenerate =
      !hasActiveDraftForTarget &&
      (noOperatorResponseYet || afterLongOperatorReading || helperWantsGenerate);

    if (shouldGenerate) {
      try {
        const response = await fetch(`${internalBaseUrl}/api/generate-replies`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            customerId,
            rewriteInput: "",
            targetCustomerMessageId: targetMessageId,
            autoMode: true,
          }),
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || `自动生成建议失败: HTTP ${response.status}`);
        }
      } catch (error) {
        console.error("runInboundAutomation generate error:", error);
      }
    }

    try {
      await publishRealtimeRefresh({
        customerId,
        reason: shouldGenerate ? "automation-updated" : "analysis-updated",
      });
    } catch (error) {
      console.error("runInboundAutomation publish error:", error);
    }

    await prisma.automationJob.update({
      where: {
        customerId_targetMessageId_kind: {
          customerId,
          targetMessageId,
          kind: AutomationJobKind.INBOUND_WORKFLOW,
        },
      },
      data: {
        status: AutomationJobStatus.DONE,
        finishedAt: new Date(),
        attemptCount: { increment: 1 },
        lastError: normalizeText(helper.autoReason) || null,
      },
    });
  } catch (error) {
    console.error("runInboundAutomation error:", error);

    await prisma.automationJob.update({
      where: {
        customerId_targetMessageId_kind: {
          customerId,
          targetMessageId,
          kind: AutomationJobKind.INBOUND_WORKFLOW,
        },
      },
      data: {
        status: AutomationJobStatus.FAILED,
        finishedAt: new Date(),
        attemptCount: { increment: 1 },
        lastError: String(error),
      },
    });
  }
}
