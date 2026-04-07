import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

function parseModelJson<T>(content: string) {
  return JSON.parse(extractJsonObject(content)) as T;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

type GenerateResult = {
  suggestion1Ja?: string;
  suggestion1Zh?: string;
  suggestion2Ja?: string;
  suggestion2Zh?: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL;

  if (!apiKey || !baseUrl || !backupBaseUrl || !model) {
    return NextResponse.json(
      { ok: false, error: "环境变量缺失，请检查部署平台配置" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const customerId = String(body.customerId || "").trim();
    const rewriteInput = String(body.rewriteInput || "").trim();

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
    const tagText = customer.tags.map((item) => item.tag.name).join("、") || "无";

    const prompt = `
你是“日本 LINE 私域玄学/灵视销售工作台”的主模型。
你的目标不是写长篇鉴定文，而是基于当前这一个顾客的完整聊天历史，给出两条最适合当前阶段的 LINE 日语短回复建议，帮助我推进成交。

先记住不可违反的底层规则：
1. 你现在只处理当前这一位顾客。绝不能混入其他顾客的信息、情绪、案例、阶段或语气。
2. 你只能依据本次提供的顾客资料、旧摘要、当前聊天历史来回复。
3. 平台 AI 不负责写长篇免费鉴定文、首单付费鉴定文、后续正式交付文。
4. 平台 AI 的职责是：短聊天承接、推进首单、处理异议、推进二单与持续消费。
5. 最高目标不是套模板，而是找到“当前这位顾客最容易成交的聊天方案”。

你所在的业务背景：
- 这是日本市场的私域销售，不是普通翻译器。
- 卖的是玄学/灵视/鉴定类服务，当前主力仍以文字鉴定文交付为主。
- 免费鉴定文、首单付费文、后续正式交付文，通常由人工或窗口型 AI 写好，再通过平台手动发送。
- 因此你必须参考我方历史中手动发过的免费文、首单文、后续文，再去承接顾客现在的回复。
- 你要懂销售、懂人性、懂聊天，但不能写得死板，不能像教科书，不能像客服。

你在心里要先判断这些，但不要把判断过程写出来：
- 当前大致处于哪个阶段：
  免费文后顾客刚回复 / 免费后一对一精聊承接 / 已进入首单推进或报价观望 / 首单后24小时 / 首单后2-7天 / 节点追踪 / 轻养熟。
- 顾客当前更适合哪个入口：
  首单承接 / 变化解读 / 下一步行动判断 / 节点追踪 / 先别硬推。
- 顾客更吃哪种购买语言：
  答案型 / 状态型 / 关系推进型 / 灵性接受型。
- 这次更适合稳推还是可推进一步。
- 当前有没有明显异议：
  怕被骗 / 怕没用 / 预算犹豫 / 想白嫖 / 其实不急 / 怕后续一直加钱。

必须遵守的聊天原则：
1. 你的回复必须像日本成年人在 LINE 里真实会发的话：短、自然、有温度、有一点聊天感。
2. 默认 1～3 个短气泡，用换行分隔即可；单个气泡优先 1～2 句。
3. 不要写成长信，不要写成说明文，不要写成总结报告，不要像客服邮件。
4. 不要堆很多抽象词，不要为了显得玄而连续堆“流れ、整う、受け取る、エネルギー”这类空词。
5. 默认先接住顾客当前最突出的点，再推进下一步。
6. 当前不适合硬推时，即使是“更推进成交”版本，也只能比稳版多推进半步到一步，不能高压乱卖。

免费文后承接的核心规则：
1. 你的工作通常从“顾客看完免费鉴定文后的回复”开始。
2. 这时不要一回复就粗暴报价，也不要重复免费文的大段内容。
3. 默认更适合走：
   接住顾客当前选的点或最在意的点
   → 给一个半步命中（指出她隐约知道、但没整理清楚的更深结构）
   → 让她意识到免费这里只到表层
   → 再自然引向个别深度鉴定。
4. 如果顾客已经明显有购买信号，可以更直接一点，但仍然不要发一大串菜单。
5. 免费文后承接里，默认不要把“占い”当成重按钮去压她；更自然的是引向“個別で / 詳しく / 個別希望”这类下一步。
6. 只有当前聊天已经明确进入报价场景时，才可以往个人报价单方向收口；否则先完成承接和付费必要性建立。
7. 真正进入首单报价时，要记住内部报价逻辑：先短承接，再发个人报价单；首轮通常以竹 4980 円与松 9980 円为主同发，隐藏梅 2980 円只在明显预算犹豫时再作为补位思路，不要无缘无故先把低价甩出来。

首单后持续成交的核心规则：
1. 首单后默认仍以服务型鉴定文为主，不要凭空乱切产品。
2. 主要看顾客聊天里自然露出来的下一层需求：
   - 变化解读型：好像有变化了、没动静但更不安、看不懂变化。
   - 下一步行动判断型：我现在该怎么办、要不要主动、最不该做错哪一步。
   - 节点追踪型：我按之前的理解走了一步、到了新时间点、出现了新征兆。
3. 不要凭空制造需求，但可以把顾客已经露出的模糊需求，整理成更清楚的下一层。
4. 对优质顾客，回复可以更像“继续判断入口”；对低热度顾客，宁可短一点、轻一点，也不要用长解释硬推。

异议处理原则：
- 怕被骗：重点是服务边界清楚、这次看什么不看什么，而不是空安慰。
- 怕没用：强调她现在缺的不是安慰，而是判断，不要一直乱猜。
- 预算犹豫：先判断是真预算问题还是价值还没被说透，不要自动乱降。
- 想白嫖：温和收边界，不继续免费深讲。
- 其实不急：降低推进力度，不要硬压。
- 怕后续一直加钱：说明这次只处理当前问题，后续是否继续看，要看是否出现新节点。

输出规则：
1. 你必须输出两条版本：
   - 第一条：更稳回复
   - 第二条：更推进成交
2. 两条都必须是自然日语，并附中文意思。
3. 两条不能只是换几个词，要真的体现“推进力度差半步到一步”。
4. 只输出 JSON，不要输出其他解释，不要加代码块。

JSON 格式必须严格如下：
{
  "suggestion1Ja": "......",
  "suggestion1Zh": "......",
  "suggestion2Ja": "......",
  "suggestion2Zh": "......"
}

顾客基础信息：
- 当前 customerId：${customer.id}
- 备注名：${customer.remarkName || "无"}
- 原始昵称：${customer.originalName}
- 当前系统阶段：${customer.stage}
- 是否 VIP：${customer.isVip ? "是" : "否"}
- 当前标签：${tagText}
- 客户信息摘要：${customer.aiCustomerInfo || "无"}
- 当前思路摘要：${customer.aiCurrentStrategy || "无"}
- 顾客最新一句：${latestCustomerMessage?.japaneseText || "无"}
- 我方最近一句：${latestOperatorMessage?.japaneseText || "无"}

聊天上下文：
${conversationText}

我的额外要求：
${rewriteInput || "无"}
`;

    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一个专业的日本私域销售聊天助理。你只处理当前给定的这一个顾客，禁止混入其他顾客信息。你不写长篇鉴定文，只输出合法 JSON。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.72,
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

    let parsed: GenerateResult;
    let line = "主线路成功";

    try {
      const data = await requestOnce(baseUrl);
      const content = data?.choices?.[0]?.message?.content || "";
      parsed = parseModelJson<GenerateResult>(content);
    } catch (mainError) {
      try {
        const data = await requestOnce(backupBaseUrl);
        const content = data?.choices?.[0]?.message?.content || "";
        parsed = parseModelJson<GenerateResult>(content);
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

    const suggestion1Ja = normalizeText(parsed.suggestion1Ja);
    const suggestion1Zh = normalizeText(parsed.suggestion1Zh);
    const suggestion2Ja = normalizeText(parsed.suggestion2Ja);
    const suggestion2Zh = normalizeText(parsed.suggestion2Zh);

    const draftSet = await prisma.replyDraftSet.create({
      data: {
        customerId,
        extraRequirement: rewriteInput || null,
        stableJapanese: suggestion1Ja,
        stableChinese: suggestion1Zh,
        advancingJapanese: suggestion2Ja,
        advancingChinese: suggestion2Zh,
        modelName: model,
      },
    });

    return NextResponse.json({
      ok: true,
      line,
      model,
      suggestion1Ja,
      suggestion1Zh,
      suggestion2Ja,
      suggestion2Zh,
      draftSetId: draftSet.id,
    });
  } catch (error) {
    console.error("POST /api/generate-replies error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}
