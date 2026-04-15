import { prisma } from "../../prisma";
import { computeAiEvalMetricsFromDrafts } from "./eval-metrics-core";

export async function getAiEvalMetrics(windowDays = 30) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.replyDraftSet.findMany({
    where: { createdAt: { gte: since } },
    select: {
      customerId: true,
      routeType: true,
      sceneType: true,
      pushLevel: true,
      selectedVariant: true,
      recommendedVariant: true,
      isStale: true,
      staleReason: true,
      finalGateJson: true,
      reviewFlagsJson: true,
      aiReviewJson: true,
      analysisPromptVersion: true,
      generationPromptVersion: true,
      reviewPromptVersion: true,
      translationPromptVersion: true,
    },
  });

  return computeAiEvalMetricsFromDrafts(rows, windowDays);
}
