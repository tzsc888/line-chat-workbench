import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EffectiveBucket,
  EffectiveTier,
  FollowupTimingKey,
  resolveFollowupView,
  timingKeyToNextFollowupAt,
} from "@/lib/followup-rules";

type DbMessage = {
  type: "TEXT" | "IMAGE";
  role: "CUSTOMER" | "OPERATOR";
  source?: "LINE" | "MANUAL" | "AI_SUGGESTION";
  japaneseText: string;
  chineseText: string | null;
};

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

function parseModelJson<T>(content: string): T {
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

function shortenForContext(text: string, max = 900) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;

  const head = Math.max(320, Math.floor(max * 0.65));
  const tail = Math.max(140, max - head - 30);
  return `${normalized.slice(0, head)} …… ${normalized.slice(-tail)}`;
}

function formatConversation(messages: DbMessage[]) {
  return messages
    .map((msg, index) => {
      const who = msg.role === "CUSTOMER" ? "顾客" : "我方";
      const typeText = msg.type === "IMAGE" ? "图片消息" : "文字消息";
      const sourceText = msg.source ? `\n来源：${msg.source}` : "";
      const japanese = shortenForContext(msg.japaneseText || "", msg.role === "OPERATOR" ? 1100 : 700);
      const chinese = msg.chineseText ? shortenForContext(msg.chineseText, 260) : "";

      return `${index + 1}. ${who}${sourceText}\n消息类型：${typeText}\n日语原文：${japanese}\n中文意思：${chinese}`;
    })
    .join("\n\n");
}

type AnalyzeResult = {
  customerInfo?: string;
  currentStrategy?: string;
  followupTier?: EffectiveTier;
  followupReason?: string;
  followupTimingKey?: FollowupTimingKey;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.HELPER_MODEL;

  if (!apiKey || !baseUrl || !backupBaseUrl || !model) {
    return NextResponse.json(
      { ok: false, error: "环境变量缺失，请检查部署平台配置" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const customerId = String(body.customerId || "").trim();

    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "缺少 customerId" },
        { status: 400 }
      );
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        messages: {
          orderBy: {
            sentAt: "desc",
          },
          take: 80,
        },
      },
    });

    if (!customer) {
      return NextResponse.json(
        { ok: false, error: "客户不存在" },
        { status: 404 }
      );
    }

    const messages = [...(customer.messages as DbMessage[])].reverse();
    const latestCustomerMessage = [...messages]
      .reverse()
      .find((msg) => msg.role === "CUSTOMER");
    const latestOperatorMessage = [...messages]
      .reverse()
      .find((msg) => msg.role === "OPERATOR");

    const conversationText = formatConversation(messages);
    const tagNames = customer.tags.map((item) => item.tag.name);
    const tagText = tagNames.join("、") || "无";
    const currentFollowup = resolveFollowupView({
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

    const prompt = `
你是“日本 LINE 私域玄学/灵视销售工作台”的副模型整理助手。
你的任务不是写长文，不是写鉴定文，而是把当前这个顾客的状态，用极短的中文整理给主模型和人工看；并顺手给跟进中心一个保守、可落地的分层建议。

先记住不可违反的底层规则：
1. 你现在只处理当前这一位顾客，绝不能带入任何其他顾客的情绪、阶段、案例、语气或信息。
2. 你只能依据本次提供的顾客资料、聊天历史、旧摘要来判断。
3. 长篇免费鉴定文、首单付费鉴定文、后续正式交付文，不由你写。
4. 平台里的 AI 主要负责 LINE 短聊天承接、推进首单、处理异议、推进二单与持续消费。
5. 最高目标不是机械套流程，而是判断“当前这位顾客最容易成交的下一步”。

业务背景：
- 这是日本市场的私域销售，不是普通翻译器。
- 卖的是玄学/灵视/鉴定类服务，核心载体先以文字交付为主。
- 顾客常见流程：自动收资料 → 简短首响 → 免费鉴定文（人工/窗口 AI 写） → 顾客回复免费鉴定文 → 一对一精聊承接 → 首单报价 → 首单成交 → 首单后继续服务型鉴定文为主的复购。
- 平台 AI 的职责起点，通常从“顾客看完免费鉴定文后的回复”开始。

请你在心里做这些判断，但不要把推理过程写出来：
- 当前大致处于哪个阶段：
  收资料后待免费文 / 免费文已发顾客刚回复 / 免费后承接中 / 已进入首单推进或报价观望 / 首单后24小时 / 首单后2-7天 / 节点追踪 / 轻养熟。
- 顾客更像哪种购买语言：
  答案型 / 状态型 / 关系推进型 / 灵性接受型。
- 当前最优入口更像哪种：
  首单承接 / 变化解读 / 下一步行动判断 / 节点追踪 / 轻养熟。
- 当前推进力度应该是：
  稳推 / 轻推 / 可推进一步 / 先别硬推。
- 当前最需要警惕的问题是什么：
  免费说太多 / 推太硬 / 继续白送深层判断 / 写太像客服或报告。

跟进中心输出要求：
- bucket 不需要你判断，系统会自己根据 VIP 信号决定。
- 你只需要判断：
  1) 当前投入等级 followupTier：A / B / C
  2) 当前简短跟进原因 followupReason：一句中文，18字内
  3) 默认跟进档位 followupTimingKey：
     24H / 2D / 5D / 7D / 14D / NONE
- 规则要保守：
  - A = 现在最值得投入
  - B = 可以跟但不急
  - C = 先放着
- 时间也是默认档位，不是死规则；顾客一旦来新消息，系统会重新判断。
- 如果当前几乎不值得主动跟，followupTimingKey 可以给 NONE。

输出要求：
1. 只输出 JSON，不要输出其他解释，不要加代码块。
2. JSON 格式必须严格如下：
{
  "customerInfo": "......",
  "currentStrategy": "......",
  "followupTier": "A",
  "followupReason": "......",
  "followupTimingKey": "24H"
}
3. customerInfo：1-2句中文，尽量控制在 50 个字以内。
4. currentStrategy：1-2句中文，尽量控制在 65 个字以内。
5. followupReason：一句短中文，18字以内。
6. 不要写空话，不要写成长分析，不要写成列表。
7. 只给“当前判断”，不要假装给终局判断。

顾客基础信息：
- 当前 customerId：${customer.id}
- 备注名：${customer.remarkName || "无"}
- 原始昵称：${customer.originalName}
- 当前系统阶段：${customer.stage}
- 是否 VIP：${customer.isVip ? "是" : "否"}
- 当前标签：${tagText}
- 旧的客户信息摘要：${customer.aiCustomerInfo || "无"}
- 旧的当前思路摘要：${customer.aiCurrentStrategy || "无"}
- 跟进中心当前默认状态：
  - bucket：${currentFollowup.bucket}
  - tier：${currentFollowup.tier}
  - reason：${currentFollowup.reason}
  - nextFollowupAt：${currentFollowup.nextFollowupAt ? currentFollowup.nextFollowupAt.toISOString() : "无"}
- 顾客最新一句：${latestCustomerMessage?.japaneseText || "无"}
- 我方最近一句：${latestOperatorMessage?.japaneseText || "无"}

聊天上下文：
${conversationText}
`;

    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一个专业的私域销售整理助手。你只处理当前给定的这一个顾客，只输出合法 JSON，禁止混入其他顾客信息。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.25,
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

    let parsed: AnalyzeResult;
    let line = "主线路成功";

    try {
      const data = await requestOnce(baseUrl);
      const content = data?.choices?.[0]?.message?.content || "";
      parsed = parseModelJson<AnalyzeResult>(content);
    } catch (mainError) {
      try {
        const data = await requestOnce(backupBaseUrl);
        const content = data?.choices?.[0]?.message?.content || "";
        parsed = parseModelJson<AnalyzeResult>(content);
        line = "主线路失败，已切到备用线路成功";
      } catch (backupError) {
        return NextResponse.json(
          {
            ok: false,
            error: "主线路和备用线路都失败了",
            mainError: String(mainError),
            backupError: String(backupError),
          },
          { status: 500 }
        );
      }
    }

    const now = new Date();
    const customerInfo = normalizeText(parsed.customerInfo);
    const currentStrategy = normalizeText(parsed.currentStrategy);
    const followupTier = normalizeTier(parsed.followupTier);
    const followupReason = normalizeText(parsed.followupReason);
    const followupTimingKey = normalizeTimingKey(parsed.followupTimingKey);

    const nextFollowupAt =
      followupTimingKey && followupTimingKey !== "NONE"
        ? timingKeyToNextFollowupAt(followupTimingKey, customer.lastInboundMessageAt || customer.lastMessageAt || now)
        : followupTimingKey === "NONE"
        ? null
        : currentFollowup.nextFollowupAt;

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        aiCustomerInfo: customerInfo,
        aiCurrentStrategy: currentStrategy,
        aiLastAnalyzedAt: now,
        followupTier: followupTier || currentFollowup.tier,
        followupReason: followupReason || currentFollowup.reason,
        nextFollowupAt,
        followupUpdatedAt: now,
        followupState: currentFollowup.state === "PAUSED" ? "PAUSED" : "ACTIVE",
      },
    });

    return NextResponse.json({
      ok: true,
      line,
      customerInfo,
      currentStrategy,
      followup: {
        bucket: currentFollowup.bucket,
        tier: followupTier || currentFollowup.tier,
        reason: followupReason || currentFollowup.reason,
        nextFollowupAt: nextFollowupAt ? nextFollowupAt.toISOString() : null,
      },
    });
  } catch (error) {
    console.error("POST /api/analyze-customer error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}
