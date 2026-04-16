export type SceneType =
  | "INITIAL_CONTACT"
  | "POST_FREE_CONTENT_FIRST_REAL_FEEDBACK"
  | "INTERESTED_BUT_INFO_INSUFFICIENT"
  | "CLEAR_OBJECTION"
  | "BUDGET_HESITATION"
  | "LIGHT_NURTURE"
  | "POST_PURCHASE_FOLLOWUP"
  | "DO_NOT_PUSH_OR_NOT_WORTH_GENERATING";

export type RouteType =
  | "NO_GENERATION"
  | "JUST_HOLD"
  | "LIGHT_HOLD"
  | "STEADY_PUSH"
  | "OBJECTION_HANDLING"
  | "LIGHT_NURTURE"
  | "POST_PURCHASE_CARE"
  | "DO_NOT_PUSH";

export type PushLevel = "NO_PUSH" | "LIGHT_HOLD" | "STEADY_PUSH" | "HALF_STEP_PUSH";
export type InterestLevel = "HIGH" | "MEDIUM" | "LOW";
export type ResistanceLevel = "NONE" | "LIGHT" | "MEDIUM" | "STRONG";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type FollowupTierValue = "A" | "B" | "C";
export type FollowupBucketValue = "UNCONVERTED" | "VIP";
export type FollowupStateValue = "ACTIVE" | "DONE" | "PAUSED" | "OBSERVING" | "WAITING_WINDOW" | "POST_PURCHASE_CARE";
export type FollowupBucketTiming = "IMMEDIATE" | "TODAY" | "IN_1_DAY" | "IN_3_DAYS" | "IN_7_DAYS" | "NO_SET";
export type ReplyLength = "SHORT" | "MEDIUM";
export type ReviewResult = "PASS" | "PASS_WITH_NOTE" | "NOT_RECOMMENDED_FOR_DIRECT_USE" | "REGENERATE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type IndustryStage = "INTAKE_RECEPTION" | "POST_FREE_READING_CONVERSION" | "POST_FIRST_ORDER_RETENTION";
export type BuyerLanguage = "ANSWER" | "STATE" | "RELATIONSHIP" | "SPIRITUAL" | "UNKNOWN";
export type ConversionWindow = "NONE" | "LIGHT" | "REAL";
export type ConversionStep = "RECEIVE" | "HALF_HIT" | "BUILD_PAID_NECESSITY" | "INVITE_INDIVIDUAL";
export type DeliveryType = "FREE_READING" | "FIRST_ORDER_READING" | "FOLLOWUP_READING";
export type DeliveryCtaType = "TOPIC_REPLY" | "INDIVIDUAL_REQUEST" | "NONE";

export type DeliveryContext = {
  deliveryType: DeliveryType | null;
  summary: string;
  coreTheme: string | null;
  ctaType: DeliveryCtaType | null;
  ctaOptions: string[];
  alreadySaid: string[];
  boundaryReminder: string;
};

export type ContextMessage = {
  id: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE";
  source?: "LINE" | "MANUAL" | "AI_SUGGESTION";
  japaneseText: string;
  chineseText: string | null;
  sentAt?: string | Date;
};

export type TranslationResult = {
  translation: string;
  tone_notes: string;
  ambiguity_notes: string;
  attention_points: string[];
};

export type AnalysisResult = {
  scene_assessment: {
    scene_type: SceneType;
    relationship_stage: string;
    latest_message_focus: string;
    tone_attitude: string;
    industry_stage: IndustryStage;
    buyer_language: BuyerLanguage;
    interest_level: InterestLevel;
    resistance_level: ResistanceLevel;
    reasoning: string;
  };
  routing_decision: {
    should_generate_reply: boolean;
    route_type: RouteType;
    reply_goal: string;
    route_reason: string;
    conversion_window: ConversionWindow;
  };
  followup_decision: {
    followup_tier: FollowupTierValue;
    followup_state: FollowupStateValue;
    next_followup_bucket: FollowupBucketTiming;
    followup_reason: string;
    should_update_followup: boolean;
  };
  generation_brief: {
    mission: string;
    must_cover: string[];
    must_avoid: string[];
    push_level: PushLevel;
    reply_length: ReplyLength;
    style_notes: string[];
    delivery_anchor: string;
    conversion_step: ConversionStep;
    boundary_to_establish: string;
  };
  state_update: {
    customer_info_delta: string[];
    strategy_delta: string[];
    stage_changed: boolean;
    risk_tags: string[];
  };
  review_flags: {
    confidence: ConfidenceLevel;
    needs_ai_review: boolean;
    needs_human_attention: boolean;
    review_reason: string;
  };
};

export type GenerationResult = {
  reply_a: {
    japanese: string;
    chinese_meaning: string;
    positioning: "SAFER";
  };
  reply_b: {
    japanese: string;
    chinese_meaning: string;
    positioning: "MORE_FORWARD_HALF_STEP";
  };
  difference_note: string;
  self_check: {
    followed_route: boolean;
    followed_push_level: boolean;
    avoided_risks: string[];
    length_control: ReplyLength;
    notes: string;
  };
};

export type ReviewIssue = {
  target: "reply_a" | "reply_b" | "both";
  issue_type: string;
  severity: RiskLevel;
  explanation: string;
};

export type AiReviewResult = {
  overall_result: ReviewResult;
  risk_level: RiskLevel;
  issues_found: ReviewIssue[];
  human_attention_note: string;
  regeneration_recommended: boolean;
};

export type ProgramCheckResult = {
  passed: boolean;
  issues: string[];
  needs_ai_review: boolean;
};

export type FinalGateResult = {
  can_show_to_human: boolean;
  can_recommend_direct_use: boolean;
  should_highlight_warning: boolean;
};

export type ReviewPipelineResult = {
  program_checks: ProgramCheckResult;
  ai_review: {
    performed: boolean;
    overall_result: ReviewResult | "";
    risk_level: RiskLevel | "";
    issues_found: ReviewIssue[];
    human_attention_note: string;
    regeneration_recommended: boolean;
  };
  final_gate: FinalGateResult;
};

export type IndustryRulesSummary = {
  stage_goal: string;
  stage_dos: string[];
  stage_donts: string[];
  stage_style: string[];
  step_rules: string[];
  buyer_language_signal: string;
  buyer_language_product_direction: string;
  must_have: string[];
};

export type AnalysisContextPack = {
  customer_profile: {
    customer_id: string;
    display_name: string;
    is_vip: boolean;
    has_purchased: boolean;
    relationship_status: string;
    long_term_summary: string;
    current_stage: string;
    current_strategy_summary: string;
    risk_tags: string[];
    current_followup_tier: string;
    current_followup_state: string;
    current_followup_bucket: string;
  };
  industry_stage: IndustryStage;
  delivery_context: DeliveryContext;
  industry_rules_summary: IndustryRulesSummary;
  latest_message: {
    message_id: string;
    japanese_text: string;
    chinese_translation: string;
    tone_notes: string;
    ambiguity_notes: string;
  };
  recent_context: Array<{
    role: "customer_or_staff";
    japanese_text: string;
    chinese_translation: string;
  }>;
  system_rules_summary: {
    core_style_rules: string[];
    core_sales_rules: string[];
    core_risk_rules: string[];
  };
};

export type GenerationContextPack = {
  industry_stage: IndustryStage;
  delivery_context: DeliveryContext;
  industry_rules_summary: IndustryRulesSummary;
  generation_brief: {
    scene_type: SceneType;
    relationship_stage: string;
    route_type: RouteType;
    reply_goal: string;
    buyer_language: BuyerLanguage;
    mission: string;
    must_cover: string[];
    must_avoid: string[];
    push_level: PushLevel;
    reply_length: ReplyLength;
    style_notes: string[];
    delivery_anchor: string;
    conversion_step: ConversionStep;
    boundary_to_establish: string;
  };
  latest_message: {
    japanese_text: string;
    chinese_translation: string;
    tone_notes: string;
  };
  recent_context: Array<{
    role: "customer_or_staff";
    japanese_text: string;
    chinese_translation: string;
  }>;
  current_status_card: {
    current_stage: string;
    current_strategy_summary: string;
    risk_tags: string[];
    has_purchased: boolean;
  };
  global_rules: {
    style_rules: string[];
    sales_rules: string[];
    risk_rules: string[];
  };
};

export type ReviewContextPack = {
  industry_stage: IndustryStage;
  delivery_context: DeliveryContext;
  industry_rules_summary: IndustryRulesSummary;
  analysis_result: {
    scene_type: SceneType;
    route_type: RouteType;
    reply_goal: string;
    push_level: PushLevel;
    buyer_language: BuyerLanguage;
    conversion_window: ConversionWindow;
    must_cover: string[];
    must_avoid: string[];
    style_notes: string[];
    delivery_anchor: string;
    conversion_step: ConversionStep;
    boundary_to_establish: string;
    confidence: ConfidenceLevel;
    needs_human_attention: boolean;
  };
  latest_message: {
    japanese_text: string;
    chinese_translation: string;
  };
  generation_result: GenerationResult;
  global_review_rules: {
    critical_rules: string[];
    style_rules: string[];
    risk_rules: string[];
  };
};
