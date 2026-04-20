import type { AnalysisResult, ReviewPipelineResult } from "./ai-types";

export function buildDraftStrategyMetadata(input: {
  analysis: AnalysisResult;
  review?: ReviewPipelineResult | null;
  strategyVersion: string;
}) {
  const reviewPayload = input.review?.ai_review || {
    performed: false,
    overall_result: "",
    risk_level: "",
    issues_found: [],
    human_attention_note: "",
    regeneration_recommended: false,
  };
  return {
    generationBriefJson: JSON.stringify({
      ...input.analysis.generation_brief,
      strategy_version: input.strategyVersion,
    }),
    reviewFlagsJson: JSON.stringify({
      ...input.analysis.review_flags,
      strategy_version: input.strategyVersion,
    }),
    aiReviewJson: JSON.stringify({
      ...reviewPayload,
      strategy_version: input.strategyVersion,
    }),
  };
}
