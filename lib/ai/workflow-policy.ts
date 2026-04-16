export type ReviewPolicyInput = {
  vip: boolean;
  analysisNeedsReview: boolean;
  programNeedsReview: boolean;
  confidence: string;
  sceneType: string;
};

export function shouldRunAiReview(params: ReviewPolicyInput) {
  if (params.vip) return true;
  if (params.analysisNeedsReview || params.programNeedsReview) return true;
  if (params.confidence === "LOW") return true;
  return ["CLEAR_OBJECTION", "BUDGET_HESITATION", "POST_PURCHASE_FOLLOWUP"].includes(params.sceneType);
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
  if (!params.autoMode) return false;
  if (params.rewriteInput.trim()) return false;
  if (!params.hasExistingDraft) return false;
  if (!params.sameTargetMessage) return false;
  if (params.alreadySelected) return false;
  if (params.isStale) return false;
  return true;
}
