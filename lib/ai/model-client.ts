export type ModelRequestOptions = {
  apiKey: string;
  baseUrl: string;
  backupBaseUrl?: string | null;
  model: string;
  system: string;
  user: string;
  temperature?: number;
};

function cleanJsonText(content: string) {
  return content.replace(/```json/gi, "").replace(/```/g, "").trim();
}

export function extractJsonObject(content: string) {
  const cleaned = cleanJsonText(content);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`模型未返回合法 JSON：${cleaned}`);
  }

  return cleaned.slice(start, end + 1);
}

export function parseJsonObject<T>(content: string): T {
  return JSON.parse(extractJsonObject(content)) as T;
}

async function postChatCompletions(url: string, options: ModelRequestOptions, useJsonMode: boolean) {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    temperature: options.temperature ?? 0.2,
  };

  if (useJsonMode) {
    body.response_format = { type: "json_object" };
  }

  return fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function requestOnce(url: string, options: ModelRequestOptions) {
  let response = await postChatCompletions(url, options, true);
  let text = await response.text();

  if (!response.ok && [400, 404, 415, 422].includes(response.status)) {
    const retry = await postChatCompletions(url, options, false);
    const retryText = await retry.text();
    if (retry.ok) {
      return JSON.parse(retryText);
    }
    response = retry;
    text = retryText;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${text}`);
  }

  return JSON.parse(text);
}

export async function requestStructuredJson<T>(options: ModelRequestOptions) {
  let line = "主线路成功";
  try {
    const data = await requestOnce(options.baseUrl, options);
    return {
      line,
      parsed: parseJsonObject<T>(data?.choices?.[0]?.message?.content || ""),
      raw: data,
    };
  } catch (mainError) {
    if (!options.backupBaseUrl) {
      throw mainError;
    }
    const data = await requestOnce(options.backupBaseUrl, options);
    line = "主线路失败，已切到备用线路成功";
    return {
      line,
      parsed: parseJsonObject<T>(data?.choices?.[0]?.message?.content || ""),
      raw: data,
    };
  }
}
