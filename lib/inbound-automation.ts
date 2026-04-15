import { AutomationJobKind, AutomationJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { generateRepliesWorkflow } from "@/lib/services/generate-replies-workflow";

const OPERATOR_PRESENCE_ID = "default";
const ACTIVE_WINDOW_MS = 60_000;
const ONLINE_WINDOW_MS = 15_000;
const OFFLINE_WINDOW_MS = 5_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDebounceMs(customerId: string) {
  const presence = await prisma.operatorPresence.findUnique({ where: { id: OPERATOR_PRESENCE_ID } });
  if (!presence) return OFFLINE_WINDOW_MS;

  const idleMs = Date.now() - presence.lastSeenAt.getTime();
  if (idleMs <= 20_000 && presence.selectedCustomerId === customerId) return ACTIVE_WINDOW_MS;
  if (idleMs <= 180_000) return ONLINE_WINDOW_MS;
  return OFFLINE_WINDOW_MS;
}

async function claimPendingJob(customerId: string, targetMessageId: string) {
  const claim = await prisma.automationJob.updateMany({
    where: {
      customerId,
      targetMessageId,
      kind: AutomationJobKind.INBOUND_WORKFLOW,
      status: AutomationJobStatus.PENDING,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    data: {
      status: AutomationJobStatus.RUNNING,
      startedAt: new Date(),
    },
  });
  return claim.count > 0;
}

async function finishJob(customerId: string, targetMessageId: string, status: AutomationJobStatus, lastError: string | null) {
  await prisma.automationJob.update({
    where: {
      customerId_targetMessageId_kind: { customerId, targetMessageId, kind: AutomationJobKind.INBOUND_WORKFLOW },
    },
    data: {
      status,
      finishedAt: new Date(),
      attemptCount: { increment: 1 },
      lastError,
    },
  });
}

async function executeInboundAutomation(customerId: string, targetMessageId: string) {
  const latestText = await prisma.message.findFirst({
    where: { customerId, role: "CUSTOMER", type: "TEXT" },
    orderBy: { sentAt: "desc" },
    select: { id: true },
  });

  if (!latestText || latestText.id !== targetMessageId) {
    await finishJob(customerId, targetMessageId, AutomationJobStatus.SKIPPED, "已有更新消息，旧任务跳过");
    return { ok: true, skipped: true };
  }

  await prisma.replyDraftSet.updateMany({
    where: {
      customerId,
      selectedVariant: null,
      isStale: false,
      NOT: { targetCustomerMessageId: targetMessageId },
    },
    data: {
      isStale: true,
      staleReason: "new-inbound-message",
      staleAt: new Date(),
    },
  });

  const json = await generateRepliesWorkflow({
    customerId,
    rewriteInput: "",
    targetCustomerMessageId: targetMessageId,
    autoMode: true,
    publishRefresh: false,
  });

  if (!json?.ok) {
    throw new Error((json as { error?: string } | undefined)?.error || "自动生成建议失败");
  }

  try {
    await publishRealtimeRefresh({ customerId, reason: (json as { skipped?: boolean } | undefined)?.skipped ? "analysis-updated" : "automation-updated" });
  } catch (error) {
    console.error("runInboundAutomation publish error:", error);
  }

  await finishJob(customerId, targetMessageId, AutomationJobStatus.DONE, null);
  return json;
}

export async function processSpecificInboundAutomationJob(customerId: string, targetMessageId: string) {
  const claimed = await claimPendingJob(customerId, targetMessageId);
  if (!claimed) return { ok: false, skipped: true, reason: "job-not-claimable" };

  try {
    return await executeInboundAutomation(customerId, targetMessageId);
  } catch (error) {
    console.error("processSpecificInboundAutomationJob error:", error);
    await finishJob(customerId, targetMessageId, AutomationJobStatus.FAILED, String(error));
    throw error;
  }
}

export async function processDueInboundAutomationJobs(limit = 20) {
  const jobs = await prisma.automationJob.findMany({
    where: {
      kind: AutomationJobKind.INBOUND_WORKFLOW,
      status: AutomationJobStatus.PENDING,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  const results: Array<{ customerId: string; targetMessageId: string; status: string }> = [];
  for (const job of jobs) {
    try {
      const result = await processSpecificInboundAutomationJob(job.customerId, job.targetMessageId);
      results.push({ customerId: job.customerId, targetMessageId: job.targetMessageId, status: result.skipped ? "SKIPPED" : "DONE" });
    } catch {
      results.push({ customerId: job.customerId, targetMessageId: job.targetMessageId, status: "FAILED" });
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
  const { customerId, targetMessageId } = options;

  const existingJob = await prisma.automationJob.findUnique({
    where: {
      customerId_targetMessageId_kind: {
        customerId,
        targetMessageId,
        kind: AutomationJobKind.INBOUND_WORKFLOW,
      },
    },
  });
  if (existingJob) return;

  const debounceMs = await getDebounceMs(customerId);
  await prisma.automationJob.create({
    data: {
      customerId,
      targetMessageId,
      kind: AutomationJobKind.INBOUND_WORKFLOW,
      status: AutomationJobStatus.PENDING,
      scheduledFor: new Date(Date.now() + debounceMs),
    },
  });

  await sleep(debounceMs);
  try {
    await processSpecificInboundAutomationJob(customerId, targetMessageId);
  } catch {
    // already recorded on the job; fallback cron worker can retry future pending jobs only.
  }
}
