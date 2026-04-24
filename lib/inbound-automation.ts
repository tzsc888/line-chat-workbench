import { AutomationJobKind, AutomationJobStatus, GenerationTaskTriggerSource, MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { PIPELINE_REASON_CODES, parsePipelineReasonCode } from "@/lib/ai/pipeline-reason";
import { createGenerationTask, processSpecificGenerationTask } from "@/lib/generation-tasks";
import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";
import { planPartialInboundJobReconcile } from "@/lib/inbound/reconcile-plan";

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

  const task = await createGenerationTask({
    customerId: job.customerId,
    rewriteInput: "",
    targetMessageId: job.targetMessageId,
    autoMode: true,
    triggerSource: GenerationTaskTriggerSource.AUTO_FIRST_INBOUND,
  });
  const execution = await processSpecificGenerationTask(task.id);

  if (!execution.ok && execution.reason !== "retry-scheduled") {
    const errorMessage =
      "error" in execution && execution.error?.code
        ? execution.error.code
        : "generate_replies_failed";
    throw new Error(errorMessage);
  }

  await publishRealtimeRefresh({
    customerId: job.customerId,
    reason: execution.workflowResult?.reusedExistingDraft ? "generation-reused" : "generation-updated",
    scopes: ["workspace", "list"],
  });

  if (execution.workflowResult?.reusedExistingDraft) {
    await finishJob(job.id, AutomationJobStatus.SKIPPED, PIPELINE_REASON_CODES.REUSED_EXISTING_DRAFT);
    return { ok: true, reusedExistingDraft: true } as const;
  }

  if (!execution.ok && execution.reason === "retry-scheduled") {
    await finishJob(job.id, AutomationJobStatus.FAILED, PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR);
    return { ok: false, retryScheduled: true } as const;
  }

  await finishJob(job.id, AutomationJobStatus.DONE, null);
  return { ok: true, reusedExistingDraft: false } as const;
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
    await finishJob(job.id, AutomationJobStatus.SKIPPED, PIPELINE_REASON_CODES.MESSAGE_NOT_FOUND);
    return { ok: true, skipped: true } as const;
  }

  if (message.chineseText?.trim()) {
    await finishJob(job.id, AutomationJobStatus.SKIPPED, PIPELINE_REASON_CODES.ALREADY_TRANSLATED);
    return { ok: true, skipped: true } as const;
  }

  const translation = await translateCustomerJapaneseMessage({ japaneseText: message.japaneseText });
  const chineseText = translation.parsed.translation?.trim() || "";

  if (!chineseText) {
    throw new Error(PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR);
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
    await finishJob(
      job.id,
      AutomationJobStatus.FAILED,
      parsePipelineReasonCode(error instanceof Error ? error.message : String(error)) || PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR,
    );
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

export async function markInboundMessageJobsSkipped(options: {
  customerId: string;
  targetMessageId: string;
  reasonCode: string;
  kinds?: AutomationJobKind[];
}) {
  const now = new Date();
  const kinds = options.kinds || [AutomationJobKind.INBOUND_TRANSLATION, AutomationJobKind.INBOUND_WORKFLOW];

  for (const kind of kinds) {
    const existing = await prisma.automationJob.findUnique({
      where: {
        customerId_targetMessageId_kind: {
          customerId: options.customerId,
          targetMessageId: options.targetMessageId,
          kind,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existing) {
      await prisma.automationJob.create({
        data: {
          customerId: options.customerId,
          targetMessageId: options.targetMessageId,
          kind,
          status: AutomationJobStatus.SKIPPED,
          scheduledFor: now,
          startedAt: now,
          finishedAt: now,
          attemptCount: 1,
          lastError: options.reasonCode,
        },
      });
      continue;
    }

    if (existing.status === AutomationJobStatus.DONE) continue;

    await prisma.automationJob.update({
      where: { id: existing.id },
      data: {
        status: AutomationJobStatus.SKIPPED,
        scheduledFor: now,
        startedAt: now,
        finishedAt: now,
        lastError: options.reasonCode,
      },
    });
  }
}

export async function processSpecificInboundAutomationJob(
  customerId: string,
  targetMessageId: string,
  kind: AutomationJobKind = AutomationJobKind.INBOUND_WORKFLOW,
) {
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

export async function tryProcessInboundJobsImmediately(options: {
  customerId: string;
  targetMessageId: string;
  includeTranslation?: boolean;
  includeWorkflow?: boolean;
  maxWaitMs?: number;
}) {
  const includeTranslation = options.includeTranslation !== false;
  const includeWorkflow = options.includeWorkflow !== false;
  const maxWaitMs = Math.max(200, Math.min(options.maxWaitMs ?? 1200, 3000));

  const kinds = [
    ...(includeTranslation ? [AutomationJobKind.INBOUND_TRANSLATION] : []),
    ...(includeWorkflow ? [AutomationJobKind.INBOUND_WORKFLOW] : []),
  ];

  const jobs = await Promise.all(
    kinds.map(async (kind) => {
      try {
        const result = await Promise.race([
          processSpecificInboundAutomationJob(options.customerId, options.targetMessageId, kind),
          new Promise<{ ok: false; skipped: true; reason: string }>((resolve) =>
            setTimeout(() => resolve({ ok: false, skipped: true, reason: PIPELINE_REASON_CODES.JOB_NOT_RUN_YET }), maxWaitMs),
          ),
        ]);
        return { kind, result };
      } catch (error) {
        console.error("tryProcessInboundJobsImmediately error:", error);
        return {
          kind,
          result: { ok: false, skipped: true, reason: PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR },
        };
      }
    }),
  );

  return {
    ok: true,
    jobs,
  };
}

export async function reconcilePartialInboundJobsForRecentMessages(limit = 200) {
  const recentMessages = await prisma.message.findMany({
    where: {
      role: "CUSTOMER",
      type: MessageType.TEXT,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      customerId: true,
      chineseText: true,
    },
  });

  if (!recentMessages.length) {
    return { scanned: 0, queued: 0 };
  }

  const targetMessageIds = recentMessages.map((message) => message.id);
  const jobs = await prisma.automationJob.findMany({
    where: { targetMessageId: { in: targetMessageIds } },
    select: {
      customerId: true,
      targetMessageId: true,
      kind: true,
    },
  });

  const actions = planPartialInboundJobReconcile({
    messages: recentMessages,
    jobs,
  });

  for (const action of actions) {
    if (action.kind === AutomationJobKind.INBOUND_TRANSLATION) {
      await queueInboundTranslation({
        customerId: action.customerId,
        targetMessageId: action.targetMessageId,
      });
      continue;
    }
    await queueInboundAutomation({
      customerId: action.customerId,
      targetMessageId: action.targetMessageId,
    });
  }

  return {
    scanned: recentMessages.length,
    queued: actions.length,
  };
}

export async function processDueInboundAutomationJobs(limit = 20) {
  const reconciled = await reconcilePartialInboundJobsForRecentMessages();

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
        status: "skipped" in result && result.skipped ? "SKIPPED" : "DONE",
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
    reconciled,
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
