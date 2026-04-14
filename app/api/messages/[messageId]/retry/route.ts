import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { dispatchOutboundMessageById } from "@/lib/outbound-message";
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
    const pendingMessage = await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: MessageSendStatus.PENDING,
        sendError: null,
        failedAt: null,
        lastAttemptAt: attemptAt,
      },
    });

    try {
      await publishRealtimeRefresh({ customerId: message.customer.id, reason: "retry-message-queued" });
    } catch (error) {
      console.error("Ably publish retry-message-queued error:", error);
    }

    after(async () => {
      await dispatchOutboundMessageById(message.id, {
        customerId: message.customer.id,
        lineUserId: message.customer.lineUserId,
        successReason: "retry-message-success",
        failureReason: "retry-message-failed",
        incrementRetryCount: true,
      });
    });

    return NextResponse.json({ ok: true, message: pendingMessage });
  } catch (error) {
    console.error("POST /api/messages/[messageId]/retry error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
