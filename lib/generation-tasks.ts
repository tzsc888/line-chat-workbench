import {
  Prisma,
  GenerationTaskStatus,
  GenerationTaskTriggerSource,
  type GenerationTask,
} from "@prisma/client";
import { isAiStructuredOutputError } from "@/lib/ai/model-client";
import { prisma } from "@/lib/prisma";
import { GenerateRepliesStageError } from "@/lib/services/generate-replies-workflow-core";
import { generateRepliesWorkflow } from "@/lib/services/generate-replies-workflow";

const localKickoffInFlight = new Set<string>();
const DEFAULT_TASK_LEASE_MS = 90_000;
const MIN_TASK_LEASE_MS = 15_000;
const MAX_TASK_LEASE_MS = 15 * 60_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

type CreateGenerationTaskInput = {
  customerId: string;
  rewriteInput?: string;
  targetMessageId?: string | null;
  autoMode?: boolean;
  triggerSource: GenerationTaskTriggerSource;
};

type SerializableTask = {
  id: string;
  customerId: string;
  targetMessageId: string | null;
  rewriteInput: string | null;
  autoMode: boolean;
  triggerSource: GenerationTaskTriggerSource;
  status: GenerationTaskStatus;
  stage: string;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetailsJson: string | null;
  resultDraftSetId: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  leaseExpiresAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function compactErrorMessage(input: unknown, max = 500) {
  const raw = input instanceof Error ? input.message : String(input || "");
  return raw.slice(0, max);
}

function compactDetails(details: string[], max = 10, itemMax = 300) {
  return details.slice(0, max).map((item) => String(item || "").slice(0, itemMax));
}

function safeSnippet(value: unknown, max = 700) {
  return String(value || "").replace(/\s+/g, " ").slice(0, max);
}

function toSerializableTask(task: GenerationTask): SerializableTask {
  return {
    id: task.id,
    customerId: task.customerId,
    targetMessageId: task.targetMessageId,
    rewriteInput: task.rewriteInput,
    autoMode: task.autoMode,
    triggerSource: task.triggerSource,
    status: task.status,
    stage: task.stage,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    errorDetailsJson: task.errorDetailsJson,
    resultDraftSetId: task.resultDraftSetId,
    attemptCount: task.attemptCount,
    maxAttempts: task.maxAttempts,
    nextRetryAt: task.nextRetryAt?.toISOString() || null,
    leaseExpiresAt: task.leaseExpiresAt?.toISOString() || null,
    startedAt: task.startedAt?.toISOString() || null,
    finishedAt: task.finishedAt?.toISOString() || null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function buildRetryAt(attemptCount: number) {
  const backoffSeconds = Math.min(60, Math.max(5, attemptCount * 10));
  return new Date(Date.now() + backoffSeconds * 1000);
}

function buildManualDedupeKey(input: {
  customerId: string;
  targetMessageId: string | null;
  rewriteInput: string | null;
}) {
  return `manual:${input.customerId}:${input.targetMessageId || "_"}:${input.rewriteInput || "_"}`;
}

function parseDetailsJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function parseLeaseMs() {
  const raw = Number(process.env.GENERATION_TASK_LEASE_MS || "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TASK_LEASE_MS;
  return Math.max(MIN_TASK_LEASE_MS, Math.min(MAX_TASK_LEASE_MS, Math.floor(raw)));
}

function buildLeaseExpiresAt() {
  return new Date(Date.now() + parseLeaseMs());
}

function staleCutoffDate() {
  return new Date(Date.now() - parseLeaseMs());
}

function isStaleRunningTask(task: { startedAt: Date | null; updatedAt: Date; leaseExpiresAt: Date | null }) {
  if (task.leaseExpiresAt instanceof Date) {
    return task.leaseExpiresAt.getTime() <= Date.now();
  }
  const cutoff = staleCutoffDate().getTime();
  const startedAtMs = task.startedAt?.getTime() || 0;
  if (startedAtMs > 0) return startedAtMs <= cutoff;
  return task.updatedAt.getTime() <= cutoff;
}

async function recoverSingleStaleRunningTask(taskId: string) {
  const running = await prisma.generationTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      stage: true,
      startedAt: true,
      updatedAt: true,
      leaseExpiresAt: true,
      attemptCount: true,
      maxAttempts: true,
    },
  });
  if (!running || running.status !== GenerationTaskStatus.RUNNING) return false;
  if (!isStaleRunningTask(running)) return false;

  const exhausted = running.attemptCount >= running.maxAttempts;
  const nextStatus = exhausted ? GenerationTaskStatus.FAILED : GenerationTaskStatus.PENDING;
  const nextStage = exhausted ? "failed" : "retry-scheduled";

  const recovered = await prisma.generationTask.updateMany({
    where: {
      id: running.id,
      status: GenerationTaskStatus.RUNNING,
    },
    data: {
      status: nextStatus,
      stage: nextStage,
      errorCode: exhausted ? "TASK_STALE_TIMEOUT" : "TASK_STALE_REQUEUED",
      errorMessage: exhausted ? "generation_task_stale_timeout" : "generation_task_stale_requeued",
      errorDetailsJson: JSON.stringify({
        stale: true,
        previousStage: running.stage,
        leaseMs: parseLeaseMs(),
      }),
      nextRetryAt: exhausted ? null : new Date(),
      leaseExpiresAt: null,
      finishedAt: exhausted ? new Date() : null,
    },
  });

  return recovered.count > 0;
}

async function recoverStaleRunningTasks(limit = 20) {
  const cutoff = staleCutoffDate();
  const staleTasks = await prisma.generationTask.findMany({
    where: {
      status: GenerationTaskStatus.RUNNING,
      OR: [
        { leaseExpiresAt: { lte: new Date() } },
        { leaseExpiresAt: null, startedAt: { lte: cutoff } },
        { leaseExpiresAt: null, startedAt: null, updatedAt: { lte: cutoff } },
      ],
    },
    orderBy: [{ updatedAt: "asc" }],
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true },
  });

  let recovered = 0;
  for (const staleTask of staleTasks) {
    if (await recoverSingleStaleRunningTask(staleTask.id)) {
      recovered += 1;
    }
  }
  return recovered;
}

function normalizeTaskError(error: unknown) {
  if (error instanceof GenerateRepliesStageError) {
    return {
      code: error.code,
      message: compactErrorMessage(error),
      stage: error.stage,
      details: {
        elapsed_ms: error.elapsedMs,
        ...(error.details || {}),
      },
      retryable: error.retryable,
    };
  }

  if (isAiStructuredOutputError(error)) {
    const stage = error.stage === "reply_translation" ? "translation" : "generation";
    const isTimeout = error.code === "MODEL_TIMEOUT";
    return {
      code: isTimeout ? `${stage}_structured_timeout` : `${stage}_structured_failed`,
      message: compactErrorMessage(error),
      stage,
      details: {
        structured_error_code: error.code,
        mode: error.mode,
        status: error.status,
        failure_reason: error.failureReason,
        parse_phase: error.parsePhase,
        provider_elapsed_ms: error.providerElapsedMs,
        timeout_ms: error.timeoutMs,
        retryable: error.retryable,
        provider_role: error.providerRole,
        provider_attempt: error.attempt,
        provider_max_attempts: error.maxAttempts,
        content_type: error.contentType,
        final_url_host_and_path: error.finalUrlHostAndPath,
        response_format_sent: error.responseFormatSent,
        stream_sent: error.streamSent,
        fetch_error_name: error.fetchErrorName,
        fetch_error_message: error.fetchErrorMessage,
        fetch_cause_name: error.fetchCauseName,
        fetch_cause_code: error.fetchCauseCode,
        fetch_cause_message: error.fetchCauseMessage,
        upstream_body_snippet: safeSnippet(error.upstreamBodySnippet || error.snippet || "", 700),
        model_content_snippet: safeSnippet(error.modelContentSnippet || "", 700),
        top_level_keys: error.topLevelKeys,
        choices_length: error.choicesLength,
        sse_event_count: error.sseEventCount,
        assembled_content_length: error.assembledContentLength,
        details: compactDetails(error.details || []),
      },
      retryable: error.code === "MODEL_TIMEOUT" || error.code === "MODEL_HTTP_ERROR",
    };
  }

  const message = compactErrorMessage(error);
  const nonRetryableStageError =
    message === "generation_missing_japanese_reply" ||
    message === "translation_missing_reply_meaning";
  const nonRetryableStage =
    message === "translation_missing_reply_meaning" ? "translation" : "generation";

  return {
    code: nonRetryableStageError ? message : "WORKFLOW_ERROR",
    message,
    stage: nonRetryableStageError ? nonRetryableStage : "workflow",
    details: null,
    retryable: !nonRetryableStageError,
  };
}

async function claimTask(taskId: string) {
  await recoverSingleStaleRunningTask(taskId);

  const claim = await prisma.generationTask.updateMany({
    where: {
      id: taskId,
      status: GenerationTaskStatus.PENDING,
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    data: {
      status: GenerationTaskStatus.RUNNING,
      stage: "running",
      startedAt: new Date(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      errorDetailsJson: null,
      leaseExpiresAt: buildLeaseExpiresAt(),
      attemptCount: { increment: 1 },
    },
  });

  return claim.count > 0;
}

function startTaskHeartbeat(taskId: string) {
  const timer = setInterval(() => {
    void prisma.generationTask
      .updateMany({
        where: {
          id: taskId,
          status: GenerationTaskStatus.RUNNING,
        },
        data: {
          leaseExpiresAt: buildLeaseExpiresAt(),
        },
      })
      .catch((error) => {
        console.error("generation task heartbeat error:", error);
      });
  }, HEARTBEAT_INTERVAL_MS);

  return () => {
    clearInterval(timer);
  };
}

export async function createGenerationTask(input: CreateGenerationTaskInput) {
  const customerId = String(input.customerId || "").trim();
  if (!customerId) {
    throw new Error("missing customerId");
  }

  const normalizedTargetMessageId = String(input.targetMessageId || "").trim() || null;
  const normalizedRewriteInput = String(input.rewriteInput || "").trim() || null;
  const autoMode = input.autoMode === true;
  const manualDedupeKey =
    input.triggerSource === GenerationTaskTriggerSource.MANUAL_GENERATE
      ? buildManualDedupeKey({
          customerId,
          targetMessageId: normalizedTargetMessageId,
          rewriteInput: normalizedRewriteInput,
        })
      : null;

  if (manualDedupeKey) {
    const existing = await prisma.generationTask.findFirst({
      where: {
        dedupeKey: manualDedupeKey,
        triggerSource: GenerationTaskTriggerSource.MANUAL_GENERATE,
        status: { in: [GenerationTaskStatus.PENDING, GenerationTaskStatus.RUNNING] },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    if (existing) {
      return toSerializableTask(existing);
    }
  }

  const task = await prisma.generationTask
    .create({
      data: {
        customerId,
        targetMessageId: normalizedTargetMessageId,
        dedupeKey: manualDedupeKey,
        rewriteInput: normalizedRewriteInput,
        autoMode,
        triggerSource: input.triggerSource,
        status: GenerationTaskStatus.PENDING,
        stage: "queued",
        nextRetryAt: null,
        leaseExpiresAt: null,
      },
    })
    .catch(async (error) => {
      if (
        manualDedupeKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.generationTask.findFirst({
          where: {
            dedupeKey: manualDedupeKey,
            triggerSource: GenerationTaskTriggerSource.MANUAL_GENERATE,
            status: { in: [GenerationTaskStatus.PENDING, GenerationTaskStatus.RUNNING] },
          },
          orderBy: [{ createdAt: "desc" }],
        });
        if (existing) return existing;
      }
      throw error;
    });

  return toSerializableTask(task);
}

export async function getGenerationTaskByScope(input: { taskId: string; customerId: string }) {
  const taskId = String(input.taskId || "").trim();
  const customerId = String(input.customerId || "").trim();
  if (!taskId || !customerId) return null;

  const task = await prisma.generationTask.findFirst({
    where: {
      id: taskId,
      customerId,
    },
  });

  if (!task) return null;
  return toSerializableTask(task);
}

export async function processSpecificGenerationTask(taskId: string) {
  const claimed = await claimTask(taskId);
  if (!claimed) return { ok: false, skipped: true as const, reason: "task-not-claimable" };

  const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, skipped: true as const, reason: "task-not-found" };

  const stopHeartbeat = startTaskHeartbeat(task.id);
  const workflowStartedAt = Date.now();
  try {
    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        stage: "workflow",
      },
    });

    const result = await generateRepliesWorkflow({
      customerId: task.customerId,
      rewriteInput: task.rewriteInput || "",
      targetCustomerMessageId: task.targetMessageId || null,
      autoMode: task.autoMode,
      publishRefresh: true,
      triggerSource: task.triggerSource,
    });
    const translationStatus = String((result as { translationStatus?: string } | null)?.translationStatus || "").trim();
    const translationFailed = translationStatus === "failed";
    const translationErrorCode = String((result as { translationErrorCode?: string } | null)?.translationErrorCode || "").trim() || null;
    const translationErrorMessage =
      String((result as { translationErrorMessage?: string } | null)?.translationErrorMessage || "").trim() || null;

    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: GenerationTaskStatus.SUCCEEDED,
        stage: translationFailed ? "completed-with-translation-failure" : "completed",
        errorCode: translationFailed ? translationErrorCode : null,
        errorMessage: translationFailed ? translationErrorMessage : null,
        errorDetailsJson: translationFailed
          ? JSON.stringify({
              translationStatus: "failed",
              translationErrorCode,
              translationErrorMessage,
            })
          : null,
        resultDraftSetId: String((result as { draftSetId?: string } | null)?.draftSetId || "").trim() || null,
        nextRetryAt: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    });

    return {
      ok: true,
      skipped: false as const,
      taskStatus: GenerationTaskStatus.SUCCEEDED,
      workflowResult: result,
    };
  } catch (error) {
    const totalElapsedMs = Math.max(0, Date.now() - workflowStartedAt);
    const normalized = normalizeTaskError(error);
    const canRetry = task.attemptCount < task.maxAttempts && normalized.retryable;
    console.error(
      `[generate-replies] failed customer=${task.customerId} task=${task.id} code=${normalized.code} stage=${normalized.stage} total_elapsed_ms=${totalElapsedMs} retryable=${canRetry}`,
    );
    if (normalized.stage === "generation" && normalized.details && typeof normalized.details === "object") {
      const details = normalized.details as Record<string, unknown>;
      console.error(
        `[ai-generation-failure-summary] code=${normalized.code} causeCode=${String(details.structured_error_code || "")} failureReason=${String(details.failure_reason || "")} parsePhase=${String(details.parse_phase || "")} elapsedMs=${String(details.elapsed_ms || totalElapsedMs)} providerElapsedMs=${String(details.provider_elapsed_ms || "")} retryable=${String(details.retryable || "")} providerRole=${String(details.provider_role || "")} providerAttempt=${String(details.provider_attempt || "")}/${String(details.provider_max_attempts || "")} httpStatus=${String(details.status || details.structured_status || "")} contentType=${String(details.content_type || "")} finalUrlHostAndPath=${String(details.final_url_host_and_path || "")} responseFormatSent=${String(details.response_format_sent || "")} streamSent=${String(details.stream_sent || "")} fetchErrorName=${String(details.fetch_error_name || "")} fetchCauseCode=${String(details.fetch_cause_code || "")} bodySnippet=${safeSnippet(details.upstream_body_snippet || "", 700)} modelContentSnippet=${safeSnippet(details.model_content_snippet || "", 700)}`,
      );
    }

    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: canRetry ? GenerationTaskStatus.PENDING : GenerationTaskStatus.FAILED,
        stage: canRetry ? "retry-scheduled" : "failed",
        errorCode: normalized.code,
        errorMessage: normalized.message,
        errorDetailsJson: JSON.stringify({
          failed_stage: normalized.stage,
          failed_code: normalized.code,
          total_elapsed_ms: totalElapsedMs,
          ...(normalized.details || {}),
        }),
        nextRetryAt: canRetry ? buildRetryAt(task.attemptCount) : null,
        leaseExpiresAt: null,
        finishedAt: canRetry ? null : new Date(),
      },
    });

    if (!canRetry) {
      return {
        ok: false,
        skipped: false as const,
        taskStatus: GenerationTaskStatus.FAILED,
        reason: "failed",
        error: {
          code: normalized.code,
          message: normalized.message,
          stage: normalized.stage,
          details: normalized.details,
        },
      };
    }

    return {
      ok: false,
      skipped: false as const,
      taskStatus: GenerationTaskStatus.PENDING,
      reason: "retry-scheduled",
      error: {
        code: normalized.code,
        message: normalized.message,
        stage: normalized.stage,
      },
    };
  } finally {
    stopHeartbeat();
  }
}

export function kickoffGenerationTask(taskId: string) {
  const id = String(taskId || "").trim();
  if (!id || localKickoffInFlight.has(id)) return;
  localKickoffInFlight.add(id);

  queueMicrotask(() => {
    void processSpecificGenerationTask(id)
      .catch((error) => {
        console.error("kickoffGenerationTask error:", error);
      })
      .finally(() => {
        localKickoffInFlight.delete(id);
      });
  });
}

export async function processDueGenerationTasks(limit = 10) {
  const recoveredStaleRunning = await recoverStaleRunningTasks();
  const size = Math.max(1, Math.min(limit, 50));
  const dueTasks = await prisma.generationTask.findMany({
    where: {
      status: GenerationTaskStatus.PENDING,
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: [{ createdAt: "asc" }],
    take: size,
    select: { id: true },
  });

  const results: Array<{ taskId: string; status: string; errorCode: string | null; errorMessage: string | null; errorDetails: unknown }> = [];

  for (const dueTask of dueTasks) {
    try {
      await processSpecificGenerationTask(dueTask.id);
      const task = await prisma.generationTask.findUnique({ where: { id: dueTask.id } });
      results.push({
        taskId: dueTask.id,
        status: task?.status || "UNKNOWN",
        errorCode: task?.errorCode || null,
        errorMessage: task?.errorMessage || null,
        errorDetails: parseDetailsJson(task?.errorDetailsJson || null),
      });
    } catch (error) {
      results.push({
        taskId: dueTask.id,
        status: "FAILED",
        errorCode: "WORKER_ERROR",
        errorMessage: compactErrorMessage(error),
        errorDetails: null,
      });
    }
  }

  return {
    recoveredStaleRunning,
    scanned: dueTasks.length,
    results,
  };
}
