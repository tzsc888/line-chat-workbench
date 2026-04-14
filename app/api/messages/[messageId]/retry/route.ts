import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { buildLineMessages, pushLineMessages } from "@/lib/line-messaging";
import { MessageRole, MessageSendStatus } from "@prisma/client";

type Props = {
  params: Promise<{ messageId: string }>;
};

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
      const lineMessages = buildLineMessages({
        type: message.type,
        japaneseText: message.japaneseText,
        imageUrl: message.imageUrl,
      });
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
