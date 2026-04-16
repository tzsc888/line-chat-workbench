import { prisma } from "@/lib/prisma";
import type { AnalysisResult, GenerationResult, ReviewPipelineResult } from "./ai-types";

export async function staleOpenDraftsForCustomer(params: {
  customerId: string;
  reason: string;
}) {
  const { customerId, reason } = params;
  await prisma.replyDraftSet.updateMany({
    where: {
      customerId,
      selectedVariant: null,
      isStale: false,
    },
    data: {
      isStale: true,
      staleReason: reason,
      staleAt: new Date(),
    },
  });
}

export async function saveDraftBundle(params: {
  customerId: string;
  targetCustomerMessageId: string | null;
  extraRequirement?: string | null;
  modelName: string;
  translationPromptVersion?: string | null;
  analysisPromptVersion?: string | null;
  generationPromptVersion?: string | null;
  reviewPromptVersion?: string | null;
  analysis: AnalysisResult;
  generation: GenerationResult;
  review: ReviewPipelineResult;
}) {
  const {
    customerId,
    targetCustomerMessageId,
    extraRequirement,
    modelName,
    translationPromptVersion,
    analysisPromptVersion,
    generationPromptVersion,
    reviewPromptVersion,
    analysis,
    generation,
    review,
  } = params;
  const recommendedVariant = review.final_gate.can_recommend_direct_use
    ? analysis.generation_brief.push_level === "HALF_STEP_PUSH" || analysis.generation_brief.push_level === "STEADY_PUSH"
      ? "ADVANCING"
      : "STABLE"
    : null;

  await staleOpenDraftsForCustomer({
    customerId,
    reason: "new-analysis-generated",
  });

  return prisma.replyDraftSet.create({
    data: {
      customerId,
      targetCustomerMessageId,
      extraRequirement: extraRequirement || null,
      stableJapanese: generation.reply_a.japanese,
      stableChinese: generation.reply_a.chinese_meaning,
      advancingJapanese: generation.reply_b.japanese,
      advancingChinese: generation.reply_b.chinese_meaning,
      modelName,
      translationPromptVersion: translationPromptVersion || null,
      analysisPromptVersion: analysisPromptVersion || null,
      generationPromptVersion: generationPromptVersion || null,
      reviewPromptVersion: reviewPromptVersion || null,
      sceneType: analysis.scene_assessment.scene_type,
      routeType: analysis.routing_decision.route_type,
      replyGoal: analysis.routing_decision.reply_goal,
      pushLevel: analysis.generation_brief.push_level,
      generationBriefJson: JSON.stringify(analysis.generation_brief),
      reviewFlagsJson: JSON.stringify(analysis.review_flags),
      programChecksJson: JSON.stringify(review.program_checks),
      aiReviewJson: JSON.stringify(review.ai_review),
      finalGateJson: JSON.stringify(review.final_gate),
      differenceNote: generation.difference_note,
      selfCheckJson: JSON.stringify(generation.self_check),
      recommendedVariant,
    },
  });
}
