export type BusinessTranslationStrategy = {
  enabled: boolean;
  preserveToneNotes: string[];
  specialTerms: string[];
};

export type BusinessSalesProcessStrategy = {
  analysisCoreSalesRules: string[];
};

export type BusinessReplyStyleStrategy = {
  analysisCoreStyleRules: string[];
  generationStyleRules: string[];
  reviewStyleRules: string[];
};

export type BusinessGenerationPolicyStrategy = {
  reuseDraft: {
    onlyAutoMode: boolean;
    requireEmptyRewriteInput: boolean;
    requireSameTargetMessage: boolean;
    requireUnselectedDraft: boolean;
    requireFreshDraft: boolean;
  };
};

export type BusinessReviewPolicyStrategy = {
  runAiReviewWhen: {
    vipAlways: boolean;
    analysisNeedsReview: boolean;
    programNeedsReview: boolean;
    confidenceLevels: string[];
    sceneTypes: string[];
  };
  reviewCriticalRules: string[];
  reviewRiskRules: string[];
};

export type BusinessFollowupPolicyStrategy = {
  defaultTierByStage: {
    aStages: string[];
    bStages: string[];
  };
  timingHours: {
    todayOffsetHours: number;
  };
  timingDays: {
    in1Day: number;
    in3Days: number;
    in7Days: number;
  };
  vipTimingByTier: {
    A: "TODAY" | "IN_3_DAYS" | "IN_7_DAYS";
    B: "TODAY" | "IN_3_DAYS" | "IN_7_DAYS";
    C: "TODAY" | "IN_3_DAYS" | "IN_7_DAYS";
  };
  unconvertedTimingByTier: {
    A: "TODAY" | "IN_1_DAY" | "IN_7_DAYS";
    B: "TODAY" | "IN_1_DAY" | "IN_7_DAYS";
    C: "TODAY" | "IN_1_DAY" | "IN_7_DAYS";
  };
  reasonTemplates: {
    unfollowed: string;
    unreadFirst: string;
    vipDefault: string;
    waitingPaymentOrNegotiating: string;
    interested: string;
    fallback: string;
  };
};

export type BusinessAdvancedStrategy = {
  temperatures: {
    translation: number;
    analysis: number;
    generation: number;
    review: number;
  };
};

export type AiBusinessStrategy = {
  version: string;
  notes: string;
  translation: BusinessTranslationStrategy;
  sales_process: BusinessSalesProcessStrategy;
  reply_style: BusinessReplyStyleStrategy;
  generation_policy: BusinessGenerationPolicyStrategy;
  review_policy: BusinessReviewPolicyStrategy;
  followup_policy: BusinessFollowupPolicyStrategy;
  advanced: BusinessAdvancedStrategy;
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateAiBusinessStrategy(input: AiBusinessStrategy) {
  assert(!!input.version.trim(), "ai-business-strategy: version 不能为空");
  assert(Array.isArray(input.translation.preserveToneNotes), "ai-business-strategy: translation.preserveToneNotes 必须是数组");
  assert(Array.isArray(input.review_policy.runAiReviewWhen.sceneTypes), "ai-business-strategy: review_policy.runAiReviewWhen.sceneTypes 必须是数组");
  assert(input.followup_policy.timingHours.todayOffsetHours > 0, "ai-business-strategy: followup_policy.timingHours.todayOffsetHours 必须大于 0");
  return input;
}
