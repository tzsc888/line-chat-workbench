import type { AiReviewResult, AnalysisResult, GenerationResult, ReviewPipelineResult, ReviewResult, RiskLevel } from "./ai-types";

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export type MainBrainGenerationResult = {
  reply_a_ja: string;
  reply_b_ja: string;
};

function pickFirstNonEmptyString(root: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asString(root[key]);
    if (value) return value;
  }
  return "";
}

export function normalizeGenerationReply(raw: unknown): MainBrainGenerationResult {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const replyAJa = pickFirstNonEmptyString(value, [
    "reply_a_ja",
    "replyAJa",
    "reply_a_japanese",
    "reply_a",
  ]);
  const replyBJa = pickFirstNonEmptyString(value, [
    "reply_b_ja",
    "replyBJa",
    "reply_b_japanese",
    "reply_b",
  ]);
  return {
    reply_a_ja: replyAJa,
    reply_b_ja: replyBJa,
  };
}

export function validateMainBrainGenerationResult(raw: unknown): MainBrainGenerationResult {
  return normalizeGenerationReply(raw);
}

// Legacy export kept for compatibility with existing tests.
export function validateGenerationResult(raw: unknown): GenerationResult {
  const parsed = validateMainBrainGenerationResult(raw);
  return {
    reply_a: {
      japanese: parsed.reply_a_ja,
      chinese_meaning: "",
      positioning: "SAFER",
    },
    reply_b: {
      japanese: parsed.reply_b_ja,
      chinese_meaning: "",
      positioning: "MORE_FORWARD_HALF_STEP",
    },
    difference_note: "",
    self_check: {
      followed_route: true,
      followed_push_level: true,
      avoided_risks: [],
      length_control: "SHORT",
      notes: "",
    },
  };
}

// Legacy export kept for compatibility with existing tests.
export function validateAnalysisResult(_raw: unknown): AnalysisResult {
  return {
    scene_assessment: {
      scene_type: "DO_NOT_PUSH_OR_NOT_WORTH_GENERATING",
      relationship_stage: "",
      latest_message_focus: "",
      tone_attitude: "",
      industry_stage: "POST_FREE_READING_CONVERSION",
      buyer_language: "UNKNOWN",
      interest_level: "LOW",
      resistance_level: "LIGHT",
      reasoning: "",
    },
    routing_decision: {
      route_type: "DO_NOT_PUSH",
      reply_goal: "",
      route_reason: "",
      conversion_window: "NONE",
    },
    followup_decision: {
      followup_tier: "B",
      followup_state: "ACTIVE",
      next_followup_bucket: "NO_SET",
      followup_reason: "",
      should_update_followup: false,
    },
    generation_brief: {
      mission: "",
      must_cover: [],
      must_avoid: [],
      push_level: "NO_PUSH",
      reply_length: "SHORT",
      style_notes: [],
      delivery_anchor: "",
      conversion_step: "RECEIVE",
      boundary_to_establish: "",
    },
    state_update: {
      customer_info_delta: [],
      strategy_delta: [],
      stage_changed: false,
      risk_tags: [],
    },
    review_flags: {
      confidence: "LOW",
      needs_ai_review: false,
      needs_human_attention: false,
      review_reason: "",
    },
  };
}

export function validateAiReviewResult(raw: unknown): AiReviewResult {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const risk = asString(value.risk_level).toUpperCase();
  const overall = asString(value.overall_result).toUpperCase();

  const riskLevel: RiskLevel = risk === "LOW" || risk === "HIGH" ? (risk as RiskLevel) : "MEDIUM";
  const overallResult: ReviewResult =
    overall === "PASS" || overall === "REGENERATE" || overall === "NOT_RECOMMENDED_FOR_DIRECT_USE"
      ? (overall as ReviewResult)
      : "PASS_WITH_NOTE";

  const issues = Array.isArray(value.issues_found) ? value.issues_found : [];

  return {
    overall_result: overallResult,
    risk_level: riskLevel,
    issues_found: issues
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        target: item.target === "reply_a" || item.target === "reply_b" ? item.target : "both",
        issue_type: asString(item.issue_type),
        severity: riskLevel,
        explanation: asString(item.explanation),
      })),
    human_attention_note: asString(value.human_attention_note),
    regeneration_recommended: asBoolean(value.regeneration_recommended),
  };
}

export function buildReviewPipelineResult(programIssues: string[], aiReview?: AiReviewResult | null): ReviewPipelineResult {
  const passed = programIssues.length === 0;
  const performed = !!aiReview;

  return {
    program_checks: {
      passed,
      issues: [...programIssues],
      needs_ai_review: !passed,
    },
    ai_review: {
      performed,
      overall_result: aiReview?.overall_result ?? "",
      risk_level: aiReview?.risk_level ?? "",
      issues_found: aiReview?.issues_found ?? [],
      human_attention_note: aiReview?.human_attention_note ?? "",
      regeneration_recommended: aiReview?.regeneration_recommended ?? false,
    },
    final_gate: {
      can_show_to_human: true,
      can_recommend_direct_use: passed,
      should_highlight_warning: !passed || !!aiReview?.human_attention_note,
    },
  };
}

