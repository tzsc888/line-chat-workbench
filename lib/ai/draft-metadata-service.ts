import { prisma } from "@/lib/prisma";
import type { AnalysisResult, GenerationResult, ReviewPipelineResult } from "./ai-types";
import { buildDraftStrategyMetadata } from "./draft-strategy-metadata";

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
  strategyVersion?: string | null;
  analysis: AnalysisResult;
  generation: GenerationResult;
  review?: ReviewPipelineResult | null;
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
    strategyVersion,
    analysis,
    generation,
    review,
  } = params;
  const recommendedVariant =
    analysis.generation_brief.push_level === "HALF_STEP_PUSH" || analysis.generation_brief.push_level === "STEADY_PUSH"
      ? "ADVANCING"
      : "STABLE";

  await staleOpenDraftsForCustomer({
    customerId,
    reason: "new-analysis-generated",
  });

  const strategyMeta = buildDraftStrategyMetadata({
    analysis,
    review: review || null,
    strategyVersion: String(strategyVersion || "").trim() || "unknown",
  });

  const programChecksPayload = review?.program_checks || {
    passed: true,
    issues: [],
    needs_ai_review: false,
  };
  const finalGatePayload = review?.final_gate || {
    can_show_to_human: true,
    can_recommend_direct_use: true,
    should_highlight_warning: false,
  };

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
      generationBriefJson: strategyMeta.generationBriefJson,
      reviewFlagsJson: strategyMeta.reviewFlagsJson,
      programChecksJson: JSON.stringify(programChecksPayload),
      aiReviewJson: strategyMeta.aiReviewJson,
      finalGateJson: JSON.stringify(finalGatePayload),
      differenceNote: generation.difference_note,
      selfCheckJson: JSON.stringify(generation.self_check),
      recommendedVariant,
    },
  });
}
