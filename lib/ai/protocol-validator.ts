import type {
  AiReviewResult,
  AnalysisResult,
  BuyerLanguage,
  ConfidenceLevel,
  ConversionStep,
  ConversionWindow,
  DeliveryCtaType,
  DeliveryContext,
  DeliveryType,
  FollowupBucketTiming,
  FollowupStateValue,
  FollowupTierValue,
  GenerationResult,
  IndustryStage,
  InterestLevel,
  PushLevel,
  ReplyLength,
  ResistanceLevel,
  ReviewPipelineResult,
  ReviewResult,
  RiskLevel,
  RouteType,
  SceneType,
} from "./ai-types";

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asChineseMeaning(value: Record<string, any>) {
  return (
    asString(value.chinese_meaning) ||
    asString(value.chinese_explanation) ||
    asString(value.chineseMeaning) ||
    asString(value.chineseExplanation) ||
    asString(value.chinese) ||
    asString(value.translation) ||
    asString(value.zh)
  );
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asSceneType(value: unknown): SceneType {
  const allowed: SceneType[] = [
    "INITIAL_CONTACT",
    "POST_FREE_CONTENT_FIRST_REAL_FEEDBACK",
    "INTERESTED_BUT_INFO_INSUFFICIENT",
    "CLEAR_OBJECTION",
    "BUDGET_HESITATION",
    "LIGHT_NURTURE",
    "POST_PURCHASE_FOLLOWUP",
    "DO_NOT_PUSH_OR_NOT_WORTH_GENERATING",
  ];
  return allowed.includes(value as SceneType)
    ? (value as SceneType)
    : "DO_NOT_PUSH_OR_NOT_WORTH_GENERATING";
}

function asRouteType(value: unknown): RouteType {
  const allowed: RouteType[] = [
    "NO_GENERATION",
    "JUST_HOLD",
    "LIGHT_HOLD",
    "STEADY_PUSH",
    "OBJECTION_HANDLING",
    "LIGHT_NURTURE",
    "POST_PURCHASE_CARE",
    "DO_NOT_PUSH",
  ];
  return allowed.includes(value as RouteType) ? (value as RouteType) : "DO_NOT_PUSH";
}

function asPushLevel(value: unknown): PushLevel {
  const allowed: PushLevel[] = ["NO_PUSH", "LIGHT_HOLD", "STEADY_PUSH", "HALF_STEP_PUSH"];
  return allowed.includes(value as PushLevel) ? (value as PushLevel) : "NO_PUSH";
}

function asInterestLevel(value: unknown): InterestLevel {
  const allowed: InterestLevel[] = ["HIGH", "MEDIUM", "LOW"];
  return allowed.includes(value as InterestLevel) ? (value as InterestLevel) : "LOW";
}

function asResistanceLevel(value: unknown): ResistanceLevel {
  const allowed: ResistanceLevel[] = ["NONE", "LIGHT", "MEDIUM", "STRONG"];
  return allowed.includes(value as ResistanceLevel) ? (value as ResistanceLevel) : "LIGHT";
}

function asIndustryStage(value: unknown): IndustryStage {
  const allowed: IndustryStage[] = [
    "INTAKE_RECEPTION",
    "POST_FREE_READING_CONVERSION",
    "POST_FIRST_ORDER_RETENTION",
  ];
  return allowed.includes(value as IndustryStage)
    ? (value as IndustryStage)
    : "POST_FREE_READING_CONVERSION";
}

function asBuyerLanguage(value: unknown): BuyerLanguage {
  const allowed: BuyerLanguage[] = ["ANSWER", "STATE", "RELATIONSHIP", "SPIRITUAL", "UNKNOWN"];
  return allowed.includes(value as BuyerLanguage) ? (value as BuyerLanguage) : "UNKNOWN";
}

function asConversionWindow(value: unknown): ConversionWindow {
  const allowed: ConversionWindow[] = ["NONE", "LIGHT", "REAL"];
  return allowed.includes(value as ConversionWindow) ? (value as ConversionWindow) : "NONE";
}

function asConversionStep(value: unknown): ConversionStep {
  const allowed: ConversionStep[] = [
    "RECEIVE",
    "HALF_HIT",
    "BUILD_PAID_NECESSITY",
    "INVITE_INDIVIDUAL",
  ];
  return allowed.includes(value as ConversionStep) ? (value as ConversionStep) : "RECEIVE";
}

function asDeliveryType(value: unknown): DeliveryType | null {
  const allowed: DeliveryType[] = ["FREE_READING", "FIRST_ORDER_READING", "FOLLOWUP_READING"];
  return allowed.includes(value as DeliveryType) ? (value as DeliveryType) : null;
}

function asDeliveryCtaType(value: unknown): DeliveryCtaType | null {
  const allowed: DeliveryCtaType[] = ["TOPIC_REPLY", "INDIVIDUAL_REQUEST", "NONE"];
  return allowed.includes(value as DeliveryCtaType) ? (value as DeliveryCtaType) : null;
}

function asDeliveryContext(value: unknown): DeliveryContext {
  const object = (value && typeof value === "object" ? value : {}) as Record<string, any>;
  return {
    deliveryType: asDeliveryType(object.deliveryType),
    summary: asString(object.summary),
    coreTheme: asString(object.coreTheme) || null,
    ctaType: asDeliveryCtaType(object.ctaType),
    ctaOptions: asStringArray(object.ctaOptions),
    alreadySaid: asStringArray(object.alreadySaid),
    boundaryReminder: asString(object.boundaryReminder),
  };
}

function asConfidence(value: unknown): ConfidenceLevel {
  const allowed: ConfidenceLevel[] = ["HIGH", "MEDIUM", "LOW"];
  return allowed.includes(value as ConfidenceLevel) ? (value as ConfidenceLevel) : "LOW";
}

function asFollowupTier(value: unknown): FollowupTierValue {
  const allowed: FollowupTierValue[] = ["A", "B", "C"];
  return allowed.includes(value as FollowupTierValue) ? (value as FollowupTierValue) : "B";
}

function asFollowupState(value: unknown): FollowupStateValue {
  const allowed: FollowupStateValue[] = [
    "ACTIVE",
    "DONE",
    "PAUSED",
    "OBSERVING",
    "WAITING_WINDOW",
    "POST_PURCHASE_CARE",
  ];
  return allowed.includes(value as FollowupStateValue) ? (value as FollowupStateValue) : "ACTIVE";
}

function asFollowupBucketTiming(value: unknown): FollowupBucketTiming {
  const allowed: FollowupBucketTiming[] = [
    "IMMEDIATE",
    "TODAY",
    "IN_1_DAY",
    "IN_3_DAYS",
    "IN_7_DAYS",
    "NO_SET",
  ];
  return allowed.includes(value as FollowupBucketTiming)
    ? (value as FollowupBucketTiming)
    : "NO_SET";
}

function asReplyLength(value: unknown): ReplyLength {
  const allowed: ReplyLength[] = ["SHORT", "MEDIUM"];
  return allowed.includes(value as ReplyLength) ? (value as ReplyLength) : "SHORT";
}

function asReviewResult(value: unknown): ReviewResult {
  const allowed: ReviewResult[] = [
    "PASS",
    "PASS_WITH_NOTE",
    "NOT_RECOMMENDED_FOR_DIRECT_USE",
    "REGENERATE",
  ];
  return allowed.includes(value as ReviewResult) ? (value as ReviewResult) : "PASS_WITH_NOTE";
}

function asRiskLevel(value: unknown): RiskLevel {
  const allowed: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];
  return allowed.includes(value as RiskLevel) ? (value as RiskLevel) : "MEDIUM";
}

export function validateAnalysisResult(raw: unknown): AnalysisResult {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const scene = (value.scene_assessment ?? {}) as Record<string, any>;
  const routing = (value.routing_decision ?? {}) as Record<string, any>;
  const followup = (value.followup_decision ?? {}) as Record<string, any>;
  const brief = (value.generation_brief ?? {}) as Record<string, any>;
  const update = (value.state_update ?? {}) as Record<string, any>;
  const review = (value.review_flags ?? {}) as Record<string, any>;

  return {
    scene_assessment: {
      scene_type: asSceneType(scene.scene_type),
      relationship_stage: asString(scene.relationship_stage),
      latest_message_focus: asString(scene.latest_message_focus),
      tone_attitude: asString(scene.tone_attitude),
      industry_stage: asIndustryStage(scene.industry_stage),
      buyer_language: asBuyerLanguage(scene.buyer_language),
      interest_level: asInterestLevel(scene.interest_level),
      resistance_level: asResistanceLevel(scene.resistance_level),
      reasoning: asString(scene.reasoning),
    },
    routing_decision: {
      route_type: asRouteType(routing.route_type),
      reply_goal: asString(routing.reply_goal),
      route_reason: asString(routing.route_reason),
      conversion_window: asConversionWindow(routing.conversion_window),
    },
    followup_decision: {
      followup_tier: asFollowupTier(followup.followup_tier),
      followup_state: asFollowupState(followup.followup_state),
      next_followup_bucket: asFollowupBucketTiming(followup.next_followup_bucket),
      followup_reason: asString(followup.followup_reason),
      should_update_followup: asBoolean(followup.should_update_followup, true),
    },
    generation_brief: {
      mission: asString(brief.mission),
      must_cover: asStringArray(brief.must_cover),
      must_avoid: asStringArray(brief.must_avoid),
      push_level: asPushLevel(brief.push_level),
      reply_length: asReplyLength(brief.reply_length),
      style_notes: asStringArray(brief.style_notes),
      delivery_anchor: asString(brief.delivery_anchor),
      conversion_step: asConversionStep(brief.conversion_step),
      boundary_to_establish: asString(brief.boundary_to_establish),
    },
    state_update: {
      customer_info_delta: asStringArray(update.customer_info_delta),
      strategy_delta: asStringArray(update.strategy_delta),
      stage_changed: asBoolean(update.stage_changed),
      risk_tags: asStringArray(update.risk_tags),
    },
    review_flags: {
      confidence: asConfidence(review.confidence),
      needs_ai_review: asBoolean(review.needs_ai_review),
      needs_human_attention: asBoolean(review.needs_human_attention),
      review_reason: asString(review.review_reason),
    },
  };
}

export function validateGenerationResult(raw: unknown): GenerationResult {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const replyA = (value.reply_a ?? {}) as Record<string, any>;
  const replyB = (value.reply_b ?? {}) as Record<string, any>;
  const self = (value.self_check ?? {}) as Record<string, any>;

  return {
    reply_a: {
      japanese: asString(replyA.japanese),
      chinese_meaning: asChineseMeaning(replyA),
      positioning: "SAFER",
    },
    reply_b: {
      japanese: asString(replyB.japanese),
      chinese_meaning: asChineseMeaning(replyB),
      positioning: "MORE_FORWARD_HALF_STEP",
    },
    difference_note: asString(value.difference_note),
    self_check: {
      followed_route: asBoolean(self.followed_route, true),
      followed_push_level: asBoolean(self.followed_push_level, true),
      avoided_risks: asStringArray(self.avoided_risks),
      length_control: asReplyLength(self.length_control),
      notes: asString(self.notes),
    },
  };
}

export function validateAiReviewResult(raw: unknown): AiReviewResult {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const issues = Array.isArray(value.issues_found) ? value.issues_found : [];

  return {
    overall_result: asReviewResult(value.overall_result),
    risk_level: asRiskLevel(value.risk_level),
    issues_found: issues
      .filter((item): item is Record<string, any> => !!item && typeof item === "object")
      .map((item) => ({
        target: item.target === "reply_a" || item.target === "reply_b" ? item.target : "both",
        issue_type: asString(item.issue_type),
        severity: asRiskLevel(item.severity),
        explanation: asString(item.explanation),
      })),
    human_attention_note: asString(value.human_attention_note),
    regeneration_recommended: asBoolean(value.regeneration_recommended),
  };
}

export function buildReviewPipelineResult(
  programIssues: string[],
  aiReview?: AiReviewResult | null,
): ReviewPipelineResult {
  const passed = programIssues.length === 0;
  const performed = !!aiReview;
  const canShow = !aiReview || aiReview.overall_result !== "REGENERATE";
  const canRecommendDirectUse = passed && (!aiReview || aiReview.overall_result === "PASS");
  const shouldWarn =
    programIssues.length > 0 ||
    !!aiReview?.human_attention_note ||
    aiReview?.overall_result === "PASS_WITH_NOTE";

  return {
    program_checks: {
      passed,
      issues: programIssues,
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
      can_show_to_human: canShow,
      can_recommend_direct_use: canRecommendDirectUse,
      should_highlight_warning: shouldWarn,
    },
  };
}
