export type DraftGenerationBrief = {
  mission?: string;
  must_cover?: string[];
  must_avoid?: string[];
  push_level?: string;
  reply_length?: string;
  style_notes?: string[];
};

export type DraftReviewFlags = {
  confidence?: string;
  needs_ai_review?: boolean;
  needs_human_attention?: boolean;
  review_reason?: string;
};

export type DraftProgramChecks = {
  passed?: boolean;
  issues?: string[];
  needs_ai_review?: boolean;
};

export type DraftAiReview = {
  performed?: boolean;
  overall_result?: string;
  risk_level?: string;
  issues_found?: Array<{
    target?: string;
    issue_type?: string;
    severity?: string;
    explanation?: string;
  }>;
  human_attention_note?: string;
  regeneration_recommended?: boolean;
};

export type DraftFinalGate = {
  can_show_to_human?: boolean;
  can_recommend_direct_use?: boolean;
  should_highlight_warning?: boolean;
};

export type DraftSelfCheck = {
  followed_route?: boolean;
  followed_push_level?: boolean;
  avoided_risks?: string[];
  length_control?: string;
  notes?: string;
};

export type ReplyDraftLike = {
  id: string;
  targetCustomerMessageId: string | null;
  stableJapanese: string;
  stableChinese: string;
  advancingJapanese: string;
  advancingChinese: string;
  sceneType: string | null;
  routeType: string | null;
  replyGoal: string | null;
  pushLevel: string | null;
  differenceNote: string | null;
  generationBriefJson: string | null;
  reviewFlagsJson: string | null;
  programChecksJson: string | null;
  aiReviewJson: string | null;
  finalGateJson: string | null;
  selfCheckJson: string | null;
  recommendedVariant: "STABLE" | "ADVANCING" | null;
  isStale: boolean;
  staleReason: string | null;
  staleAt: string | null;
  selectedVariant: "STABLE" | "ADVANCING" | null;
  selectedAt: string | null;
  createdAt: string;
  translationPromptVersion?: string | null;
  analysisPromptVersion?: string | null;
  generationPromptVersion?: string | null;
  reviewPromptVersion?: string | null;
};

export function parseDraftJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getSceneTypeLabel(value?: string | null) {
  const map: Record<string, string> = {
    INITIAL_CONTACT: "初接触",
    POST_FREE_CONTENT_FIRST_REAL_FEEDBACK: "免费内容后首次真实反馈",
    INTERESTED_BUT_INFO_INSUFFICIENT: "有兴趣但信息不足",
    CLEAR_OBJECTION: "明显异议",
    BUDGET_HESITATION: "预算犹豫",
    LIGHT_NURTURE: "轻养熟",
    POST_PURCHASE_FOLLOWUP: "成交后经营",
    DO_NOT_PUSH_OR_NOT_WORTH_GENERATING: "暂不推进",
  };
  return value ? map[value] || value : "";
}

export function getRouteTypeLabel(value?: string | null) {
  const map: Record<string, string> = {
    NO_GENERATION: "不生成",
    JUST_HOLD: "仅承接",
    LIGHT_HOLD: "轻承接",
    STEADY_PUSH: "稳妥推进",
    OBJECTION_HANDLING: "异议处理",
    LIGHT_NURTURE: "轻养熟",
    POST_PURCHASE_CARE: "成交后经营",
    DO_NOT_PUSH: "暂不推进",
  };
  return value ? map[value] || value : "";
}

export function getPushLevelLabel(value?: string | null) {
  const map: Record<string, string> = {
    NO_PUSH: "不推进",
    LIGHT_HOLD: "轻承接",
    STEADY_PUSH: "稳妥推进",
    HALF_STEP_PUSH: "半步推进",
  };
  return value ? map[value] || value : "";
}

export function getConfidenceLabel(value?: string | null) {
  const map: Record<string, string> = {
    HIGH: "高",
    MEDIUM: "中",
    LOW: "低",
  };
  return value ? map[value] || value : "";
}

export function getRiskLevelLabel(value?: string | null) {
  const map: Record<string, string> = {
    LOW: "低",
    MEDIUM: "中",
    HIGH: "高",
  };
  return value ? map[value] || value : "";
}

export function getReviewResultLabel(value?: string | null) {
  const map: Record<string, string> = {
    PASS: "通过",
    PASS_WITH_NOTE: "通过但需注意",
    NOT_RECOMMENDED_FOR_DIRECT_USE: "不建议直接使用",
    REGENERATE: "建议重生",
  };
  return value ? map[value] || value : "";
}

export function getDraftStaleReasonLabel(value?: string | null) {
  const map: Record<string, string> = {
    "new-inbound-message": "顾客发来了更新消息，旧建议已过期",
    "new-analysis-generated": "已生成更新建议，旧草稿已过期",
  };
  return value ? map[value] || value : "";
}

export function deriveDraftPresentation(latestDraft: ReplyDraftLike | null, latestCustomerMessageId: string | null) {
  const generationBrief = parseDraftJson<DraftGenerationBrief>(latestDraft?.generationBriefJson);
  const reviewFlags = parseDraftJson<DraftReviewFlags>(latestDraft?.reviewFlagsJson);
  const programChecks = parseDraftJson<DraftProgramChecks>(latestDraft?.programChecksJson);
  const aiReview = parseDraftJson<DraftAiReview>(latestDraft?.aiReviewJson);
  const finalGate = parseDraftJson<DraftFinalGate>(latestDraft?.finalGateJson);
  const selfCheck = parseDraftJson<DraftSelfCheck>(latestDraft?.selfCheckJson);

  const isUsed = !!latestDraft?.selectedVariant;
  const isStale = !!latestDraft?.isStale || (
    !!latestDraft &&
    !!latestCustomerMessageId &&
    !!latestDraft.targetCustomerMessageId &&
    latestDraft.targetCustomerMessageId !== latestCustomerMessageId
  );
  const isBlocked = !!latestDraft && finalGate?.can_show_to_human === false;
  const shouldDimDraft = isUsed || isStale || isBlocked;
  const issues = [
    ...(programChecks?.issues || []),
    ...((aiReview?.issues_found || []).map((item) => item.explanation).filter(Boolean) as string[]),
  ];

  const statusNote = isUsed
    ? `已采用${latestDraft?.selectedVariant === "STABLE" ? "A 更稳" : "B 半步推进"}`
    : isStale
      ? getDraftStaleReasonLabel(latestDraft?.staleReason) || "当前草稿已失效，请重新分析或生成"
      : isBlocked
        ? "当前草稿已被质检拦截，建议直接重新生成"
        : finalGate?.can_recommend_direct_use === false
          ? "当前结果可供参考，但不建议直接使用"
          : "当前草稿可供审核";

  const primaryActionLabel = !latestDraft
    ? "先分析后生成"
    : isStale
      ? "基于最新消息重生"
      : isBlocked
        ? "重新生成可用版本"
        : finalGate?.can_recommend_direct_use === false
          ? "重新生成更稳版本"
          : "重新生成";

  const primaryActionHint = !latestDraft
    ? "当前还没有建议草稿，先跑一次完整链路。"
    : isStale
      ? "旧草稿对应的上下文已经过期，建议先按最新消息重跑。"
      : isBlocked
        ? "当前草稿已被质检判定不建议继续使用，建议直接重生。"
        : finalGate?.can_recommend_direct_use === false
          ? "当前草稿可参考，但建议再生成一次更稳、更贴路线的版本。"
          : "如需调整语气、推进力度或避雷点，可以重新生成。";

  const reviewSummary = aiReview?.human_attention_note || reviewFlags?.review_reason || "";

  return {
    generationBrief,
    reviewFlags,
    programChecks,
    aiReview,
    finalGate,
    selfCheck,
    isUsed,
    isStale,
    isBlocked,
    shouldDimDraft,
    issues,
    statusNote,
    primaryActionLabel,
    primaryActionHint,
    reviewSummary,
  };
}
