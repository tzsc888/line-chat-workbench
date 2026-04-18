import { AutomationJobKind, AutomationJobStatus, MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";
import { generateRepliesWorkflow } from "@/lib/services/generate-replies-workflow";

const OPERATOR_PRESENCE_ID = "default";
const ACTIVE_WINDOW_MS = 60_000;
const ONLINE_WINDOW_MS = 15_000;
const OFFLINE_WINDOW_MS = 5_000;

async function getDebounceMs(customerId: string) {
  const presence = await prisma.operatorPresence.findUnique({ where: { id: OPERATOR_PRESENCE_ID } });
  if (!presence) return OFFLINE_WINDOW_MS;

  const idleMs = Date.now() - presence.lastSeenAt.getTime();
  if (idleMs <= 20_000 && presence.selectedCustomerId === customerId) return ACTIVE_WINDOW_MS;
  if (idleMs <= 180_000) return ONLINE_WINDOW_MS;
  return OFFLINE_WINDOW_MS;
}

async function finishJob(jobId: string, status: AutomationJobStatus, lastError: string | null) {
  await prisma.automationJob.update({
    where: { id: jobId },
    data: {
      status,
      finishedAt: new Date(),
      attemptCount: { increment: 1 },
      lastError,
    },
  });
}

async function claimPendingJob(jobId: string) {
  const claim = await prisma.automationJob.updateMany({
    where: {
      id: jobId,
      status: AutomationJobStatus.PENDING,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    data: {
      status: AutomationJobStatus.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      lastError: null,
    },
  });

  return claim.count > 0;
}

async function executeInboundWorkflowJob(job: {
  id: string;
  customerId: string;
  targetMessageId: string;
}) {
  const latestText = await prisma.message.findFirst({
    where: { customerId: job.customerId, role: "CUSTOMER", type: MessageType.TEXT },
    orderBy: { sentAt: "desc" },
    select: { id: true },
  });

  if (!latestText || latestText.id !== job.targetMessageId) {
    await finishJob(job.id, AutomationJobStatus.SKIPPED, "已有更新消息，旧任务跳过");
    return { ok: true, skipped: true } as const;
  }

  await prisma.replyDraftSet.updateMany({
    where: {
      customerId: job.customerId,
      selectedVariant: null,
      isStale: false,
      NOT: { targetCustomerMessageId: job.targetMessageId },
    },
    data: {
      isStale: true,
      staleReason: "new-inbound-message",
      staleAt: new Date(),
    },
  });

  const json = await generateRepliesWorkflow({
    customerId: job.customerId,
    rewriteInput: "",
    targetCustomerMessageId: job.targetMessageId,
    autoMode: true,
    publishRefresh: false,
  });

  if (!json?.ok) {
    throw new Error((json as { error?: string } | undefined)?.error || "自动生成建议失败");
  }

  await publishRealtimeRefresh({
    customerId: job.customerId,
    reason: (json as { skipped?: boolean } | undefined)?.skipped ? "analysis-updated" : "automation-updated",
    scopes: ["workspace", "list", "analysis"],
  });

  await finishJob(job.id, AutomationJobStatus.DONE, null);
  return json;
}

async function executeInboundTranslationJob(job: {
  id: string;
  customerId: string;
  targetMessageId: string;
}) {
  const message = await prisma.message.findUnique({
    where: { id: job.targetMessageId },
    select: {
      id: true,
      customerId: true,
      role: true,
      type: true,
      japaneseText: true,
      chineseText: true,
    },
  });

  if (!message || message.customerId !== job.customerId || message.role !== "CUSTOMER" || message.type !== MessageType.TEXT) {
    await finishJob(job.id, AutomationJobStatus.SKIPPED, "消息不存在或无需翻译");
    return { ok: true, skipped: true } as const;
  }

  if (message.chineseText?.trim()) {
    await finishJob(job.id, AutomationJobStatus.SKIPPED, "消息已有中文翻译");
    return { ok: true, skipped: true } as const;
  }

  const translation = await translateCustomerJapaneseMessage({ japaneseText: message.japaneseText });
  const chineseText = translation.parsed.translation?.trim() || "";

  if (!chineseText) {
    throw new Error("翻译结果为空");
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { chineseText },
  });

  await publishRealtimeRefresh({
    customerId: job.customerId,
    reason: "translation-updated",
    scopes: ["workspace", "list"],
  });

  await finishJob(job.id, AutomationJobStatus.DONE, null);
  return { ok: true, skipped: false } as const;
}

async function processSpecificJob(jobId: string) {
  const claimed = await claimPendingJob(jobId);
  if (!claimed) return { ok: false, skipped: true, reason: "job-not-claimable" } as const;

  const job = await prisma.automationJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      customerId: true,
      targetMessageId: true,
      kind: true,
    },
  });

  if (!job) return { ok: false, skipped: true, reason: "job-not-found" } as const;

  try {
    if (job.kind === AutomationJobKind.INBOUND_TRANSLATION) {
      return await executeInboundTranslationJob(job);
    }
    return await executeInboundWorkflowJob(job);
  } catch (error) {
    console.error("processSpecificInboundAutomationJob error:", error);
    await finishJob(job.id, AutomationJobStatus.FAILED, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function ensureJob(options: {
  customerId: string;
  targetMessageId: string;
  kind: AutomationJobKind;
  scheduledFor?: Date | null;
}) {
  const existing = await prisma.automationJob.findUnique({
    where: {
      customerId_targetMessageId_kind: {
        customerId: options.customerId,
        targetMessageId: options.targetMessageId,
        kind: options.kind,
      },
    },
    select: { id: true, status: true },
  });

  if (!existing) {
    return prisma.automationJob.create({
      data: {
        customerId: options.customerId,
        targetMessageId: options.targetMessageId,
        kind: options.kind,
        status: AutomationJobStatus.PENDING,
        scheduledFor: options.scheduledFor ?? null,
      },
      select: { id: true },
    });
  }

  if (existing.status === AutomationJobStatus.FAILED) {
    return prisma.automationJob.update({
      where: { id: existing.id },
      data: {
        status: AutomationJobStatus.PENDING,
        scheduledFor: options.scheduledFor ?? null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
      },
      select: { id: true },
    });
  }

  return existing;
}

export async function queueInboundAutomation(options: {
  customerId: string;
  targetMessageId: string;
}) {
  const scheduledFor = new Date(Date.now() + (await getDebounceMs(options.customerId)));
  return ensureJob({
    customerId: options.customerId,
    targetMessageId: options.targetMessageId,
    kind: AutomationJobKind.INBOUND_WORKFLOW,
    scheduledFor,
  });
}

export async function queueInboundTranslation(options: {
  customerId: string;
  targetMessageId: string;
}) {
  return ensureJob({
    customerId: options.customerId,
    targetMessageId: options.targetMessageId,
    kind: AutomationJobKind.INBOUND_TRANSLATION,
    scheduledFor: new Date(),
  });
}

export async function processSpecificInboundAutomationJob(customerId: string, targetMessageId: string, kind: AutomationJobKind = AutomationJobKind.INBOUND_WORKFLOW) {
  const job = await prisma.automationJob.findUnique({
    where: {
      customerId_targetMessageId_kind: {
        customerId,
        targetMessageId,
        kind,
      },
    },
    select: { id: true },
  });

  if (!job) return { ok: false, skipped: true, reason: "job-not-found" } as const;
  return processSpecificJob(job.id);
}

export async function processDueInboundAutomationJobs(limit = 20) {
  const jobs = await prisma.automationJob.findMany({
    where: {
      status: AutomationJobStatus.PENDING,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      customerId: true,
      targetMessageId: true,
      kind: true,
    },
  });

  const results: Array<{ customerId: string; targetMessageId: string; kind: string; status: string }> = [];
  for (const job of jobs) {
    try {
      const result = await processSpecificJob(job.id);
      results.push({
        customerId: job.customerId,
        targetMessageId: job.targetMessageId,
        kind: job.kind,
        status: result.skipped ? "SKIPPED" : "DONE",
      });
    } catch {
      results.push({
        customerId: job.customerId,
        targetMessageId: job.targetMessageId,
        kind: job.kind,
        status: "FAILED",
      });
    }
  }

  return {
    scanned: jobs.length,
    results,
  };
}

export async function runInboundAutomation(options: {
  customerId: string;
  targetMessageId: string;
}) {
  return queueInboundAutomation(options);
}
