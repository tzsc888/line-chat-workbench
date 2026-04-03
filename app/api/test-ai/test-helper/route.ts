import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.HELPER_MODEL;

  if (!apiKey || !baseUrl || !backupBaseUrl || !model) {
    return NextResponse.json(
      {
        ok: false,
        error: "环境变量缺失，请检查 .env.local",
      },
      { status: 500 }
    );
  }

  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "你是一个测试助手。请简短回复，不要多说。",
      },
      {
        role: "user",
        content: "请只回复这句话：副模型测试成功",
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
      content: data?.choices?.[0]?.message?.content || "",
      raw: data,
    });
  } catch (mainError) {
    try {
      const data = await requestOnce(backupBaseUrl);

      return NextResponse.json({
        ok: true,
        line: "主线路失败，已切到备用线路成功",
        model,
        content: data?.choices?.[0]?.message?.content || "",
        raw: data,
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