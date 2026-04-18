import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { queueOutboundMessageTask } from "@/lib/bridge-outbound";
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
            bridgeThreadId: true,
          },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ ok: false, error: "消息不存在" }, { status: 404 });
    }

    if (message.role !== MessageRole.OPERATOR) {
      return NextResponse.json({ ok: false, error: "只有我方消息才能重试发送" }, { status: 400 });
    }


    if (!message.customer.bridgeThreadId) {
      await prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: MessageSendStatus.FAILED,
          sendError: "当前客户没有 bridgeThreadId，无法重试发送",
          failedAt: new Date(),
          lastAttemptAt: new Date(),
        },
      });

      return NextResponse.json({ ok: false, error: "当前客户没有 bridgeThreadId，无法重试发送" }, { status: 400 });
    }

    const now = new Date();

    await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: MessageSendStatus.PENDING,
        sendError: null,
        failedAt: null,
        lastAttemptAt: now,
      },
    });

    const task = await queueOutboundMessageTask({
      messageId: message.id,
      customerId: message.customer.id,
      bridgeThreadId: message.customer.bridgeThreadId,
    });

    try {
      await publishRealtimeRefresh({ customerId: message.customer.id, reason: "retry-message-queued" });
    } catch (error) {
      console.error("Ably publish retry-message-queued error:", error);
    }

    return NextResponse.json({ ok: true, taskId: task.id });
  } catch (error) {
    console.error("POST /api/messages/[messageId]/retry error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
