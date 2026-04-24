import { prisma } from "../../prisma";
import { computeAiEvalMetricsFromDrafts } from "./eval-metrics-core";

export async function getAiEvalMetrics(windowDays = 30) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.replyDraftSet.findMany({
    where: { createdAt: { gte: since } },
    select: {
      customerId: true,
      selectedVariant: true,
      recommendedVariant: true,
      isStale: true,
      staleReason: true,
      generationPromptVersion: true,
      translationPromptVersion: true,
    },
  });

  return computeAiEvalMetricsFromDrafts(
    rows.map((row) => ({
      ...row,
      routeType: null,
      sceneType: null,
      pushLevel: null,
      finalGateJson: null,
      reviewFlagsJson: null,
      aiReviewJson: null,
      analysisPromptVersion: null,
      reviewPromptVersion: null,
    })),
    windowDays,
  );
}
