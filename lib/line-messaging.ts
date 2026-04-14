import { MessageType } from "@prisma/client";

export async function pushLineMessages(to: string, messages: unknown[], options?: { retryKey?: string }) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options?.retryKey ? { "X-Line-Retry-Key": options.retryKey } : {}),
    },
    body: JSON.stringify({
      to,
      messages,
    }),
  });

  const textBody = await response.text();
  if (!response.ok) {
    throw new Error(`LINE push 失败: HTTP ${response.status} - ${textBody}`);
  }
}

export function buildLineMessages(params: { type: MessageType; japaneseText: string; imageUrl?: string | null }) {
  const messages: Array<Record<string, string>> = [];

  if (params.type === MessageType.TEXT) {
    messages.push({ type: "text", text: params.japaneseText });
    return messages;
  }

  if (!params.imageUrl) {
    throw new Error("图片消息缺少 imageUrl");
  }

  messages.push({
    type: "image",
    originalContentUrl: params.imageUrl,
    previewImageUrl: params.imageUrl,
  });

  if (params.japaneseText) {
    messages.push({ type: "text", text: params.japaneseText });
  }

  return messages;
}
