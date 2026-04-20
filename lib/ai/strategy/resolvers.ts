import { AI_BUSINESS_STRATEGY } from "./ai-business-strategy";
import { validateAiBusinessStrategy } from "./schema";

function strategy() {
  return validateAiBusinessStrategy(AI_BUSINESS_STRATEGY);
}

export function resolveTranslationStrategy() {
  const s = strategy();
  return {
    enabled: s.translation.enabled,
    preserveToneNotes: [...s.translation.preserveToneNotes],
    specialTerms: [...s.translation.specialTerms],
    temperature: s.advanced.temperatures.translation,
    strategyVersion: s.version,
  };
}

export function resolveAnalysisStrategy() {
  const s = strategy();
  return {
    coreStyleRules: [...s.reply_style.analysisCoreStyleRules],
    coreSalesRules: [...s.sales_process.analysisCoreSalesRules],
    temperature: s.advanced.temperatures.analysis,
    strategyVersion: s.version,
  };
}

export function resolveGenerationStrategy() {
  const s = strategy();
  return {
    styleRules: [...s.reply_style.generationStyleRules],
    temperature: s.advanced.temperatures.generation,
    strategyVersion: s.version,
  };
}

export function resolveReviewStrategy() {
  const s = strategy();
  return {
    runAiReviewWhen: {
      vipAlways: s.review_policy.runAiReviewWhen.vipAlways,
      analysisNeedsReview: s.review_policy.runAiReviewWhen.analysisNeedsReview,
      programNeedsReview: s.review_policy.runAiReviewWhen.programNeedsReview,
      confidenceLevels: [...s.review_policy.runAiReviewWhen.confidenceLevels],
      sceneTypes: [...s.review_policy.runAiReviewWhen.sceneTypes],
    },
    criticalRules: [...s.review_policy.reviewCriticalRules],
    styleRules: [...s.reply_style.reviewStyleRules],
    riskRules: [...s.review_policy.reviewRiskRules],
    temperature: s.advanced.temperatures.review,
    strategyVersion: s.version,
  };
}

export function resolveWorkflowPolicyStrategy() {
  const s = strategy();
  return {
    reuseDraft: { ...s.generation_policy.reuseDraft },
    reviewPolicy: {
      ...s.review_policy.runAiReviewWhen,
      confidenceLevels: [...s.review_policy.runAiReviewWhen.confidenceLevels],
      sceneTypes: [...s.review_policy.runAiReviewWhen.sceneTypes],
    },
    strategyVersion: s.version,
  };
}

export function resolveFollowupStrategy() {
  const s = strategy();
  return {
    defaultTierByStage: {
      aStages: [...s.followup_policy.defaultTierByStage.aStages],
      bStages: [...s.followup_policy.defaultTierByStage.bStages],
    },
    timingHours: { ...s.followup_policy.timingHours },
    timingDays: { ...s.followup_policy.timingDays },
    vipTimingByTier: { ...s.followup_policy.vipTimingByTier },
    unconvertedTimingByTier: { ...s.followup_policy.unconvertedTimingByTier },
    reasonTemplates: { ...s.followup_policy.reasonTemplates },
    strategyVersion: s.version,
  };
}
