import { resolveWorkflowPolicyStrategy } from "@/lib/ai/strategy";

export type ReviewPolicyInput = {
  vip: boolean;
  analysisNeedsReview: boolean;
  programNeedsReview: boolean;
  confidence: string;
  sceneType: string;
};

export function shouldRunAiReview(params: ReviewPolicyInput) {
  const strategy = resolveWorkflowPolicyStrategy().reviewPolicy;
  if (strategy.vipAlways && params.vip) return true;
  if (strategy.analysisNeedsReview && params.analysisNeedsReview) return true;
  if (strategy.programNeedsReview && params.programNeedsReview) return true;
  if (strategy.confidenceLevels.includes(params.confidence)) return true;
  return strategy.sceneTypes.includes(params.sceneType);
}

export type ExistingDraftPolicyInput = {
  autoMode: boolean;
  rewriteInput: string;
  hasExistingDraft: boolean;
  sameTargetMessage: boolean;
  alreadySelected: boolean;
  isStale: boolean;
};

export function shouldReuseExistingDraft(params: ExistingDraftPolicyInput) {
  const strategy = resolveWorkflowPolicyStrategy().reuseDraft;
  if (strategy.onlyAutoMode && !params.autoMode) return false;
  if (strategy.requireEmptyRewriteInput && params.rewriteInput.trim()) return false;
  if (!params.hasExistingDraft) return false;
  if (strategy.requireSameTargetMessage && !params.sameTargetMessage) return false;
  if (strategy.requireUnselectedDraft && params.alreadySelected) return false;
  if (strategy.requireFreshDraft && params.isStale) return false;
  return true;
}
