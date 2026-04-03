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
  const model = process.env.HELPER_MODEL;

  if (!apiKey || !baseUrl || !backupBaseUrl || !model) {
    return NextResponse.json(
      { ok: false, error: "环境变量缺失，请检查 .env.local" },
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
你是一个日本私域聊天辅助整理助手。
请根据聊天内容，输出：
1. 客户信息：一句到两句，简洁说明顾客基本情况。
2. 当前思路：一句到两句，简洁说明当前最适合怎么推进。

要求：
- 用中文输出
- 不要空话
- 不要写很长
- 不要写成列表说明
- 只输出 JSON，不要输出其他解释，不要加代码块

JSON 格式必须严格如下：
{
  "customerInfo": "......",
  "currentStrategy": "......"
}

聊天上下文：
${conversationText}
`;

    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content: "你是一个专业的聊天信息整理助手，只输出合法 JSON。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
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

    const now = new Date();

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        aiCustomerInfo: parsed.customerInfo || "",
        aiCurrentStrategy: parsed.currentStrategy || "",
        aiLastAnalyzedAt: now,
      },
    });

    return NextResponse.json({
      ok: true,
      line,
      model,
      customerInfo: parsed.customerInfo || "",
      currentStrategy: parsed.currentStrategy || "",
      analyzedAt: now.toISOString(),
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