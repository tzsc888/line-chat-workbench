import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { queueOutboundMessageTask } from "@/lib/bridge-outbound";
import {
  MessageRole,
  MessageSendStatus,
  ScheduledMessageStatus,
  MessageType,
} from "@prisma/client";

const DUE_BATCH_SIZE = 20;
const MAX_DUE_BATCH_SIZE = 50;
const DEFAULT_MIN_DELAY_MINUTES = 5;
const MAX_DELAY_MINUTES = 24 * 60;

function normalizeMessageContent(text: string) {
  return text.replace(/\r\n/g, "\n");
}

export function normalizeScheduledAtInput(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("定时发送时间格式不正确");
  }
  return date;
}

export function validateScheduleWindow(scheduledFor: Date, minimumDelayMinutes = DEFAULT_MIN_DELAY_MINUTES) {
  const now = Date.now();
  const diff = scheduledFor.getTime() - now;
  const maxDiff = MAX_DELAY_MINUTES * 60 * 1000;
  if (diff < minimumDelayMinutes * 60 * 1000) {
    throw new Error(`请至少提前 ${minimumDelayMinutes} 分钟设置定时发送。`);
  }
  if (diff > maxDiff) {
    throw new Error("当前定时发送最多支持 24 小时以内。");
  }
}

export async function dispatchScheduledMessageById(scheduledMessageId: string) {
  const attemptAt = new Date();

  const claimed = await prisma.scheduledMessage.updateMany({
    where: {
      id: scheduledMessageId,
      status: ScheduledMessageStatus.PENDING,
    },
    data: {
      status: ScheduledMessageStatus.PROCESSING,
      lastAttemptAt: attemptAt,
      retryCount: { increment: 1 },
      sendError: null,
    },
  });

  if (!claimed.count) {
    return { ok: false, skipped: true, reason: "not-pending" };
  }

  const scheduled = await prisma.scheduledMessage.findUnique({
    where: { id: scheduledMessageId },
    include: {
      customer: {
        select: {
          id: true,
          bridgeThreadId: true,
        },
      },
    },
  });

  if (!scheduled) {
    return { ok: false, skipped: true, reason: "not-found" };
  }

  const normalizedText = normalizeMessageContent(scheduled.japaneseText);

  if (scheduled.type === MessageType.IMAGE) {
    await prisma.scheduledMessage.update({
      where: { id: scheduled.id },
      data: {
        status: ScheduledMessageStatus.FAILED,
        failedAt: attemptAt,
        sendError: "当前 bridge 第一阶段仅支持文字定时发送",
      },
    });
    return {
      ok: false,
      scheduledMessageId: scheduled.id,
      reason: "image-not-supported-yet",
    };
  }

  if (!scheduled.customer.bridgeThreadId) {
    await prisma.scheduledMessage.update({
      where: { id: scheduled.id },
      data: {
        status: ScheduledMessageStatus.FAILED,
        failedAt: attemptAt,
        sendError: "当前客户没有 bridgeThreadId，无法发送定时消息",
      },
    });
    return {
      ok: false,
      scheduledMessageId: scheduled.id,
      reason: "missing-bridge-thread-id",
    };
  }

  let messageId = scheduled.deliveredMessageId || null;

  try {
    let messageRecord = messageId ? await prisma.message.findUnique({ where: { id: messageId } }) : null;

    if (!messageRecord) {
      messageRecord = await prisma.message.create({
        data: {
          customerId: scheduled.customerId,
          role: MessageRole.OPERATOR,
          type: scheduled.type,
          source: scheduled.source,
          japaneseText: normalizedText,
          chineseText: scheduled.chineseText,
          imageUrl: null,
          sentAt: attemptAt,
          deliveryStatus: MessageSendStatus.PENDING,
          lastAttemptAt: attemptAt,
        },
      });
      messageId = messageRecord.id;

      await prisma.scheduledMessage.update({
        where: { id: scheduled.id },
        data: {
          deliveredMessageId: messageRecord.id,
        },
      });
    } else {
      await prisma.message.update({
        where: { id: messageRecord.id },
        data: {
          japaneseText: normalizedText,
          chineseText: scheduled.chineseText,
          imageUrl: null,
          sentAt: attemptAt,
          deliveryStatus: MessageSendStatus.PENDING,
          sendError: null,
          failedAt: null,
          lastAttemptAt: attemptAt,
        },
      });
      messageId = messageRecord.id;
    }

    await prisma.customer.update({
      where: { id: scheduled.customerId },
      data: {
        lastMessageAt: attemptAt,
        lastOutboundMessageAt: attemptAt,
      },
    });

    if (!messageId) {
      throw new Error("scheduled message 缺少关联的 messageId，无法加入发送队列");
    }

    const task = await queueOutboundMessageTask({
      messageId,
      customerId: scheduled.customerId,
      bridgeThreadId: scheduled.customer.bridgeThreadId,
    });

    try {
      await publishRealtimeRefresh({ customerId: scheduled.customerId, reason: "scheduled-message-queued" });
    } catch (error) {
      console.error("Ably publish scheduled-message-queued error:", error);
    }

    return { ok: true, scheduledMessageId: scheduled.id, messageId, taskId: task.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedAt = new Date();

    if (messageId) {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          deliveryStatus: MessageSendStatus.FAILED,
          sendError: errorMessage,
          failedAt,
          lastAttemptAt: failedAt,
        },
      });
    }

    await prisma.scheduledMessage.update({
      where: { id: scheduled.id },
      data: {
        status: ScheduledMessageStatus.PENDING,
        failedAt: null,
        sendError: errorMessage,
        lastAttemptAt: failedAt,
      },
    });

    try {
      await publishRealtimeRefresh({ customerId: scheduled.customerId, reason: "scheduled-message-failed" });
    } catch (ablyError) {
      console.error("Ably publish scheduled-message-failed error:", ablyError);
    }

    return { ok: false, scheduledMessageId: scheduled.id, error: errorMessage };
  }
}

export async function dispatchDueScheduledMessages(options?: { batchSize?: number }) {
  const batchSize = Math.min(Math.max(options?.batchSize ?? DUE_BATCH_SIZE, 1), MAX_DUE_BATCH_SIZE);
  const now = new Date();
  const dueItems = await prisma.scheduledMessage.findMany({
    where: {
      status: ScheduledMessageStatus.PENDING,
      scheduledFor: {
        lte: now,
      },
    },
    orderBy: {
      scheduledFor: "asc",
    },
    take: batchSize,
    select: {
      id: true,
    },
  });

  const results = [] as Array<Record<string, unknown>>;

  for (const item of dueItems) {
    const result = await dispatchScheduledMessageById(item.id);
    results.push(result as Record<string, unknown>);
  }

  const dueCount = await prisma.scheduledMessage.count({
    where: {
      status: ScheduledMessageStatus.PENDING,
      scheduledFor: {
        lte: now,
      },
    },
  });
  const dispatchedCount = results.filter((item) => item.ok === true).length;
  const skippedCount = results.filter((item) => item.skipped === true).length;
  const failedCount = results.length - dispatchedCount - skippedCount;

  return {
    scannedAt: now.toISOString(),
    serverNow: now.toISOString(),
    batchSize,
    dueCount,
    hasMoreDue: dueCount > dueItems.length,
    pickedCount: dueItems.length,
    dispatchedCount,
    skippedCount,
    failedCount,
    results,
  };
}
