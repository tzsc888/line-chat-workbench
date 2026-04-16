import { prisma } from "@/lib/prisma";
import type { AnalysisResult } from "./ai-types";
import { deriveEffectiveBucket } from "@/lib/followup-rules";
import { mapAnalysisFollowupState, mergeUniqueTags, mergeUniqueText, stageToCustomerStage, timingBucketToDate } from "./state-merge-helpers";

export { mapAnalysisFollowupState, mergeUniqueTags, mergeUniqueText, stageToCustomerStage, timingBucketToDate } from "./state-merge-helpers";

export async function applyAnalysisStateToCustomer(params: {
  customerId: string;
  previousCustomerInfo: string | null;
  previousStrategy: string | null;
  previousRiskTags?: string[] | null;
  isVip: boolean;
  analysis: AnalysisResult;
}) {
  const { customerId, previousCustomerInfo, previousStrategy, previousRiskTags, isVip, analysis } = params;
  const nextFollowupAt = timingBucketToDate(analysis.followup_decision.next_followup_bucket);
  const mergedCustomerInfo = mergeUniqueText(previousCustomerInfo || "", analysis.state_update.customer_info_delta);
  const mergedStrategy = mergeUniqueText(previousStrategy || "", analysis.state_update.strategy_delta);
  const mergedRiskTags = mergeUniqueTags(previousRiskTags || [], analysis.state_update.risk_tags);
  const inferredStage = stageToCustomerStage(analysis.scene_assessment.relationship_stage);
  const followupBucket = deriveEffectiveBucket({ isVip, followupBucket: isVip ? "VIP" : "UNCONVERTED" });

  const data: Record<string, unknown> = {
    aiCustomerInfo: mergedCustomerInfo || previousCustomerInfo,
    aiCurrentStrategy: mergedStrategy || previousStrategy,
    aiLastAnalyzedAt: new Date(),
    followupBucket,
    followupTier: analysis.followup_decision.followup_tier,
    followupState: mapAnalysisFollowupState(analysis.followup_decision.followup_state),
    nextFollowupBucket: analysis.followup_decision.next_followup_bucket,
    followupReason: analysis.followup_decision.followup_reason,
    nextFollowupAt,
    riskTags: mergedRiskTags,
    followupUpdatedAt: new Date(),
  };

  if (inferredStage) {
    data.stage = inferredStage;
  }

  return prisma.customer.update({
    where: { id: customerId },
    data,
  });
}
