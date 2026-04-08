import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { MessageRole, MessageSendStatus, MessageType } from "@prisma/client";

type Props = {
  params: Promise<{ messageId: string }>;
};

async function pushLineMessages(to: string, messages: unknown[]) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to, messages }),
  });

  const textBody = await response.text();
  if (!response.ok) {
    throw new Error(`LINE push 失败: HTTP ${response.status} - ${textBody}`);
  }
}

function buildLineMessages(type: MessageType, japaneseText: string, imageUrl: string | null) {
  if (type === MessageType.TEXT) {
    return [{ type: "text", text: japaneseText }];
  }

  if (!imageUrl) {
    throw new Error("图片消息缺少 imageUrl");
  }

  const messages: any[] = [
    {
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    },
  ];

  if (japaneseText) {
    messages.push({ type: "text", text: japaneseText });
  }

  return messages;
}

export async function POST(_: Request, { params }: Props) {
  try {
    const { messageId } = await params;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        customer: {
          select: {
            id: true,
            lineUserId: true,
          },
        },
      },
    });

    if (!message || message.role !== MessageRole.OPERATOR) {
      return NextResponse.json({ ok: false, error: "消息不存在" }, { status: 404 });
    }

    if (!message.customer.lineUserId) {
      return NextResponse.json({ ok: false, error: "当前客户没有 LINE userId" }, { status: 400 });
    }

    const attemptAt = new Date();
    await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: MessageSendStatus.PENDING,
        sendError: null,
        lastAttemptAt: attemptAt,
      },
    });

    try {
      const lineMessages = buildLineMessages(message.type, message.japaneseText, message.imageUrl);
      await pushLineMessages(message.customer.lineUserId, lineMessages);

      const sentMessage = await prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: MessageSendStatus.SENT,
          sendError: null,
          failedAt: null,
          lastAttemptAt: attemptAt,
          retryCount: { increment: 1 },
        },
      });

      try {
        await publishRealtimeRefresh({ customerId: message.customer.id, reason: "retry-message-success" });
      } catch (error) {
        console.error("Ably publish retry-message-success error:", error);
      }

      return NextResponse.json({ ok: true, message: sentMessage });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedAt = new Date();

      const failedMessage = await prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: MessageSendStatus.FAILED,
          sendError: errorMessage,
          failedAt,
          lastAttemptAt: failedAt,
          retryCount: { increment: 1 },
        },
      });

      try {
        await publishRealtimeRefresh({ customerId: message.customer.id, reason: "retry-message-failed" });
      } catch (ablyError) {
        console.error("Ably publish retry-message-failed error:", ablyError);
      }

      return NextResponse.json({ ok: false, error: errorMessage, message: failedMessage }, { status: 502 });
    }
  } catch (error) {
    console.error("POST /api/messages/[messageId]/retry error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
