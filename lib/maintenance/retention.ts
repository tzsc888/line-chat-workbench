import { AutomationJobStatus, UiRefreshOutboxStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function readDays(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function runDataRetentionCleanup() {
  const webhookDays = readDays("RETENTION_LINE_WEBHOOK_RECEIPT_DAYS", 30);
  const automationDoneDays = readDays("RETENTION_AUTOMATION_DONE_DAYS", 14);
  const automationFailedDays = readDays("RETENTION_AUTOMATION_FAILED_DAYS", 30);
  const staleDraftDays = readDays("RETENTION_STALE_DRAFT_DAYS", 45);
  const selectedDraftDays = readDays("RETENTION_SELECTED_DRAFT_DAYS", 180);
  const realtimeDeliveredDays = readDays("RETENTION_REALTIME_DELIVERED_DAYS", 7);
  const realtimeFailedDays = readDays("RETENTION_REALTIME_FAILED_DAYS", 30);

  const [webhookReceipts, automationDone, automationFailed, staleDrafts, selectedDrafts, realtimeDelivered, realtimeFailed] = await prisma.$transaction([
    prisma.lineWebhookEventReceipt.deleteMany({ where: { createdAt: { lt: daysAgo(webhookDays) } } }),
    prisma.automationJob.deleteMany({
      where: {
        status: { in: [AutomationJobStatus.DONE, AutomationJobStatus.SKIPPED] },
        finishedAt: { lt: daysAgo(automationDoneDays) },
      },
    }),
    prisma.automationJob.deleteMany({
      where: {
        status: AutomationJobStatus.FAILED,
        finishedAt: { lt: daysAgo(automationFailedDays) },
      },
    }),
    prisma.replyDraftSet.deleteMany({
      where: {
        isStale: true,
        staleAt: { lt: daysAgo(staleDraftDays) },
      },
    }),
    prisma.replyDraftSet.deleteMany({
      where: {
        selectedVariant: { not: null },
        selectedAt: { lt: daysAgo(selectedDraftDays) },
      },
    }),
    prisma.uiRefreshOutbox.deleteMany({
      where: {
        status: UiRefreshOutboxStatus.DELIVERED,
        deliveredAt: { lt: daysAgo(realtimeDeliveredDays) },
      },
    }),
    prisma.uiRefreshOutbox.deleteMany({
      where: {
        status: UiRefreshOutboxStatus.FAILED,
        updatedAt: { lt: daysAgo(realtimeFailedDays) },
      },
    }),
  ]);

  return {
    webhookDays,
    automationDoneDays,
    automationFailedDays,
    staleDraftDays,
    selectedDraftDays,
    realtimeDeliveredDays,
    realtimeFailedDays,
    deleted: {
      webhookReceipts: webhookReceipts.count,
      automationDone: automationDone.count,
      automationFailed: automationFailed.count,
      staleDrafts: staleDrafts.count,
      selectedDrafts: selectedDrafts.count,
      realtimeDelivered: realtimeDelivered.count,
      realtimeFailed: realtimeFailed.count,
    },
  };
}
