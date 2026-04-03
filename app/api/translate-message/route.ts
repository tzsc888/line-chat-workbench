import { NextRequest, NextResponse } from "next/server";

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

  const body = await req.json();
  const japanese = body.japanese || "";

  if (!japanese.trim()) {
    return NextResponse.json(
      { ok: false, error: "缺少日语内容" },
      { status: 400 }
    );
  }

  const prompt = `
请把下面这句日语自然地翻译成简洁准确的中文。
要求：
1. 只输出中文
2. 不要解释
3. 不要加引号
4. 保留语气和情绪

日语：
${japanese}
`;

  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "你是一个日语到中文的翻译助手，只输出中文翻译结果。",
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

    return NextResponse.json({
      ok: true,
      line: "主线路成功",
      model,
      chinese: data?.choices?.[0]?.message?.content?.trim() || "",
    });
  } catch (mainError) {
    try {
      const data = await requestOnce(backupBaseUrl);

      return NextResponse.json({
        ok: true,
        line: "主线路失败，已切到备用线路成功",
        model,
        chinese: data?.choices?.[0]?.message?.content?.trim() || "",
      });
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
}