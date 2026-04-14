import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { ScheduledMessageStatus } from "@prisma/client";

type Props = {
  params: Promise<{ scheduledMessageId: string }>;
};

export async function DELETE(_: Request, { params }: Props) {
  try {
    const { scheduledMessageId } = await params;

    const existing = await prisma.scheduledMessage.findUnique({
      where: { id: scheduledMessageId },
      select: {
        id: true,
        customerId: true,
        status: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: "定时发送任务不存在" }, { status: 404 });
    }

    if (![ScheduledMessageStatus.PENDING, ScheduledMessageStatus.FAILED].includes(existing.status)) {
      return NextResponse.json({ ok: false, error: "当前状态不能取消这条定时发送" }, { status: 400 });
    }

    const updated = await prisma.scheduledMessage.update({
      where: { id: scheduledMessageId },
      data: {
        status: ScheduledMessageStatus.CANCELED,
        canceledAt: new Date(),
      },
    });

    try {
      await publishRealtimeRefresh({ customerId: existing.customerId, reason: "scheduled-message-canceled" });
    } catch (error) {
      console.error("Ably publish scheduled-message-canceled error:", error);
    }

    return NextResponse.json({ ok: true, scheduledMessage: updated });
  } catch (error) {
    console.error("DELETE /api/scheduled-messages/[scheduledMessageId] error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
