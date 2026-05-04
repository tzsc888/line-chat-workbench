import {
  MessageSendStatus,
  MessageSource,
  OutboundTaskStatus,
  Prisma,
  ScheduledMessageStatus,
  SuggestionVariant,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";

type QueueParams = {
  messageId: string;
  customerId: string;
  bridgeThreadId: string;
};

const OUTBOUND_SUCCESS_TIMEOUT_MS = 120_000;
const DEFAULT_FAIL_EXPIRED_OUTBOUND_TASKS_LIMIT = 50;

export type FailExpiredOutboundTasksResult = {
  scanned: number;
  processed: number;
  failed: number;
  errors: Array<{ taskId: string; error: string }>;
};

export async function queueOutboundMessageTask(params: QueueParams) {
  const existing = await prisma.outboundTask.findUnique({
    where: { messageId: params.messageId },
  });

  if (existing) {
    return prisma.outboundTask.update({
      where: { id: existing.id },
      data: {
        bridgeThreadId: params.bridgeThreadId,
        status: OutboundTaskStatus.PENDING,
        claimedAt: null,
        completedAt: null,
        failedAt: null,
        lastError: null,
        nextRetryAt: null,
        attemptCount: 0,
      },
    });
  }

  return prisma.outboundTask.create({
    data: {
      customerId: params.customerId,
      messageId: params.messageId,
      bridgeThreadId: params.bridgeThreadId,
      status: OutboundTaskStatus.PENDING,
    },
  });
}

export async function failExpiredOutboundTasks(options?: { now?: Date; limit?: number }): Promise<FailExpiredOutboundTasksResult> {
  const now = options?.now ?? new Date();
  const requestedLimit = Number(options?.limit ?? DEFAULT_FAIL_EXPIRED_OUTBOUND_TASKS_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, Math.floor(requestedLimit)))
    : DEFAULT_FAIL_EXPIRED_OUTBOUND_TASKS_LIMIT;
  const timeoutBefore = new Date(now.getTime() - OUTBOUND_SUCCESS_TIMEOUT_MS);

  const expiredTasks = await prisma.outboundTask.findMany({
    where: {
      OR: [
        {
          status: OutboundTaskStatus.PENDING,
          updatedAt: { lt: timeoutBefore },
        },
        {
          status: OutboundTaskStatus.CLAIMED,
          claimedAt: { lt: timeoutBefore },
        },
      ],
    },
    select: {
      id: true,
      customerId: true,
      messageId: true,
    },
    take: limit,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });

  let processed = 0;
  let failed = 0;
  const errors: Array<{ taskId: string; error: string }> = [];

  for (const task of expiredTasks) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.outboundTask.update({
          where: { id: task.id },
          data: {
            status: OutboundTaskStatus.FAILED,
            claimedAt: null,
            failedAt: now,
            completedAt: null,
            nextRetryAt: null,
            lastError: "发送超时，未收到抓取平台成功回执",
          },
        });

        await tx.message.update({
          where: { id: task.messageId },
          data: {
            deliveryStatus: MessageSendStatus.FAILED,
            sendError: "发送超时，未收到抓取平台成功回执",
            failedAt: now,
            lastAttemptAt: now,
          },
        });

        await tx.scheduledMessage.updateMany({
          where: {
            deliveredMessageId: task.messageId,
          },
          data: {
            status: ScheduledMessageStatus.FAILED,
            failedAt: now,
            sendError: "发送超时，未收到抓取平台成功回执",
            lastAttemptAt: now,
          },
        });
      });

      await publishCustomerRefresh(task.customerId, "bridge-outbound-timeout");
      processed += 1;
    } catch (error) {
      failed += 1;
      const errorText = error instanceof Error ? error.message : String(error);
      errors.push({ taskId: task.id, error: errorText });
      console.error("failExpiredOutboundTasks task error:", {
        taskId: task.id,
        customerId: task.customerId,
        error: errorText,
      });
    }
  }

  return {
    scanned: expiredTasks.length,
    processed,
    failed,
    errors,
  };
}

export async function claimNextOutboundTask() {
  const now = new Date();
  const timeoutAfter = new Date(now.getTime() - OUTBOUND_SUCCESS_TIMEOUT_MS);

  const candidates = await prisma.outboundTask.findMany({
    where: {
      status: OutboundTaskStatus.PENDING,
      updatedAt: { gte: timeoutAfter },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
    take: 10,
    include: {
      message: true,
      customer: {
        select: {
          id: true,
          bridgeThreadId: true,
          remarkName: true,
          originalName: true,
          avatarUrl: true,
        },
      },
    },
  });

  for (const candidate of candidates) {
    const claimedAt = new Date();
    const claimed = await prisma.outboundTask.updateMany({
      where: {
        id: candidate.id,
        status: OutboundTaskStatus.PENDING,
      },
      data: {
        status: OutboundTaskStatus.CLAIMED,
        claimedAt,
        failedAt: null,
        completedAt: null,
        lastError: null,
        attemptCount: { increment: 1 },
      },
    });

    if (!claimed.count) continue;

    return prisma.outboundTask.findUnique({
      where: { id: candidate.id },
      include: {
        message: true,
        customer: {
          select: {
            id: true,
            bridgeThreadId: true,
            remarkName: true,
            originalName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  return null;
}

function randomInt(min: number, max: number) {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function computeRetryBackoffMs() {
  return randomInt(8_000, 15_000);
}

async function publishCustomerRefresh(customerId: string, reason: string) {
  try {
    await publishRealtimeRefresh({ customerId, reason });
  } catch (error) {
    console.error(`Ably publish ${reason} error:`, error);
  }
}

async function markSuggestionSelected(params: {
  messageId: string;
  customerId: string;
}) {
  const message = await prisma.message.findUnique({
    where: { id: params.messageId },
    select: {
      source: true,
    },
  });

  if (message?.source !== MessageSource.AI_SUGGESTION) return;

  const scheduled = await prisma.scheduledMessage.findFirst({
    where: {
      deliveredMessageId: params.messageId,
      source: MessageSource.AI_SUGGESTION,
      suggestionVariant: {
        in: [SuggestionVariant.STABLE, SuggestionVariant.ADVANCING],
      },
    },
    select: {
      replyDraftSetId: true,
      suggestionVariant: true,
    },
  });

  if (!scheduled?.replyDraftSetId || !scheduled.suggestionVariant) return;

  await prisma.replyDraftSet.updateMany({
    where: {
      id: scheduled.replyDraftSetId,
      customerId: params.customerId,
    },
    data: {
      selectedVariant: scheduled.suggestionVariant,
      selectedAt: new Date(),
    },
  });
}

export async function completeOutboundTask(params: {
  taskId: string;
  ok: boolean;
  error?: string;
}) {
  const task = await prisma.outboundTask.findUnique({
    where: { id: params.taskId },
    include: {
      message: true,
      customer: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!task) {
    throw new Error("发送任务不存在");
  }

  const now = new Date();

  if (params.ok) {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.outboundTask.update({
        where: { id: task.id },
        data: {
          status: OutboundTaskStatus.SENT,
          completedAt: now,
          failedAt: null,
          lastError: null,
        },
      });

      await tx.message.update({
        where: { id: task.messageId },
        data: {
          sentAt: now,
          deliveryStatus: MessageSendStatus.SENT,
          sendError: null,
          failedAt: null,
          lastAttemptAt: now,
        },
      });

      await tx.customer.update({
        where: { id: task.customerId },
        data: {
          lastMessageAt: now,
          lastOutboundMessageAt: now,
        },
      });

      await tx.scheduledMessage.updateMany({
        where: {
          deliveredMessageId: task.messageId,
        },
        data: {
          status: ScheduledMessageStatus.SENT,
          processedAt: now,
          failedAt: null,
          sendError: null,
        },
      });
    });

    await markSuggestionSelected({
      messageId: task.messageId,
      customerId: task.customerId,
    });

    await publishCustomerRefresh(task.customerId, "bridge-outbound-sent");
    return { ok: true };
  }

  const errorMessage = String(params.error || "bridge 发送失败");
  const shouldRetry = task.attemptCount < 3;
  const nextRetryAt = shouldRetry ? new Date(now.getTime() + computeRetryBackoffMs()) : null;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.outboundTask.update({
      where: { id: task.id },
      data: shouldRetry
        ? {
            status: OutboundTaskStatus.PENDING,
            failedAt: now,
            completedAt: null,
            lastError: errorMessage,
            nextRetryAt,
          }
        : {
            status: OutboundTaskStatus.FAILED,
            failedAt: now,
            completedAt: null,
            lastError: errorMessage,
            nextRetryAt: null,
          },
    });

    await tx.message.update({
      where: { id: task.messageId },
      data: shouldRetry
        ? {
            deliveryStatus: MessageSendStatus.PENDING,
            sendError: `${errorMessage}（自动重试中）`,
            failedAt: now,
            lastAttemptAt: now,
            retryCount: { increment: 1 },
          }
        : {
            deliveryStatus: MessageSendStatus.FAILED,
            sendError: errorMessage,
            failedAt: now,
            lastAttemptAt: now,
            retryCount: { increment: 1 },
          },
    });

    await tx.scheduledMessage.updateMany({
      where: {
        deliveredMessageId: task.messageId,
      },
      data: shouldRetry
        ? {
            status: ScheduledMessageStatus.PENDING,
            failedAt: now,
            sendError: `${errorMessage}（自动重试中）`,
            lastAttemptAt: now,
            retryCount: { increment: 1 },
          }
        : {
            status: ScheduledMessageStatus.FAILED,
            failedAt: now,
            sendError: errorMessage,
            lastAttemptAt: now,
            retryCount: { increment: 1 },
          },
    });
  });

  await publishCustomerRefresh(
    task.customerId,
    shouldRetry ? "bridge-outbound-retry-scheduled" : "bridge-outbound-failed"
  );

  return shouldRetry
    ? {
        ok: false,
        retrying: true,
        error: errorMessage,
        nextRetryAt: nextRetryAt?.toISOString() || null,
      }
    : { ok: false, error: errorMessage };
}

export function buildBridgeAuthResponseError(error: unknown) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function parseBridgeAuthHeader(header: string | null) {
  const expected = process.env.BRIDGE_SHARED_SECRET || "";
  return !!expected && header === expected;
}
