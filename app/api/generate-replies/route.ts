import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type DbMessage = {
  type: "TEXT" | "IMAGE";
  role: "CUSTOMER" | "OPERATOR";
  japaneseText: string;
  chineseText: string | null;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL;

  if (!apiKey || !baseUrl || !backupBaseUrl || !model) {
    return NextResponse.json(
      { ok: false, error: "环境变量缺失，请检查 .env.local" },
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
        messages: {
          orderBy: {
            sentAt: "asc",
          },
          take: 100,
        },
      },
    });

    if (!customer) {
      return NextResponse.json(
        { ok: false, error: "客户不存在" },
        { status: 404 }
      );
    }

    const messages = customer.messages as DbMessage[];

    const conversationText = messages
      .map((msg) => {
        const who = msg.role === "CUSTOMER" ? "顾客" : "我方";
        const typeText = msg.type === "IMAGE" ? "图片消息" : "文字消息";

        return `${who}
消息类型：${typeText}
日语原文：${msg.japaneseText}
中文意思：${msg.chineseText || ""}`;
      })
      .join("\n\n");

    const prompt = `
你是一个非常擅长日本私域成交聊天的助理。
请根据顾客信息、当前思路、聊天上下文和我的要求，生成两条回复建议。

要求：
1. 回复语言必须是自然的日语，像真人聊天，不要翻译腔。
2. 第一条是“更稳回复”：更重视接住情绪、建立信任、自然推进。
3. 第二条是“更推进成交”：更明确推进下一步，但不能太硬、不能让顾客反感。
4. 每条都要同时给出中文意思。
5. 只输出 JSON，不要输出其他解释，不要加代码块。

JSON 格式必须严格如下：
{
  "suggestion1Ja": "......",
  "suggestion1Zh": "......",
  "suggestion2Ja": "......",
  "suggestion2Zh": "......"
}

顾客信息：
${customer.aiCustomerInfo || ""}

当前思路：
${customer.aiCurrentStrategy || ""}

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
          content: "你是一个专业的日本私域成交聊天助理，只输出合法 JSON。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
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

    function parseModelJson(content: string) {
      const cleaned = content
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      return JSON.parse(cleaned);
    }

    let parsed;
    let line = "主线路成功";

    try {
      const data = await requestOnce(baseUrl);
      const content = data?.choices?.[0]?.message?.content || "";
      parsed = parseModelJson(content);
    } catch (mainError) {
      try {
        const data = await requestOnce(backupBaseUrl);
        const content = data?.choices?.[0]?.message?.content || "";
        parsed = parseModelJson(content);
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

    const draftSet = await prisma.replyDraftSet.create({
      data: {
        customerId,
        extraRequirement: rewriteInput || null,
        stableJapanese: parsed.suggestion1Ja || "",
        stableChinese: parsed.suggestion1Zh || "",
        advancingJapanese: parsed.suggestion2Ja || "",
        advancingChinese: parsed.suggestion2Zh || "",
        modelName: model,
      },
    });

    return NextResponse.json({
      ok: true,
      line,
      model,
      suggestion1Ja: parsed.suggestion1Ja || "",
      suggestion1Zh: parsed.suggestion1Zh || "",
      suggestion2Ja: parsed.suggestion2Ja || "",
      suggestion2Zh: parsed.suggestion2Zh || "",
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