export async function translateJapaneseToChinese(japanese: string) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.HELPER_MODEL;

  if (!apiKey || !baseUrl || !backupBaseUrl || !model) {
    throw new Error("环境变量缺失，请检查服务端配置");
  }

  const normalized = japanese.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    throw new Error("缺少日语内容");
  }

  const prompt = `
请把下面这句日语自然地翻译成简洁准确的中文。
要求：
1. 只输出中文
2. 不要解释
3. 不要加引号
4. 保留语气和情绪

日语：
${normalized}
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
    return {
      ok: true,
      line: "主线路成功",
      model,
      chinese: data?.choices?.[0]?.message?.content?.trim() || "",
    };
  } catch (mainError) {
    try {
      const data = await requestOnce(backupBaseUrl);
      return {
        ok: true,
        line: "主线路失败，已切到备用线路成功",
        model,
        chinese: data?.choices?.[0]?.message?.content?.trim() || "",
      };
    } catch (backupError) {
      throw new Error(
        JSON.stringify({
          error: "主线路和备用线路都失败了",
          mainError: String(mainError),
          backupError: String(backupError),
        })
      );
    }
  }
}
