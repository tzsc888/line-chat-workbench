export type ReplyDraftLike = {
  id: string;
  targetCustomerMessageId: string | null;
  stableJapanese: string;
  stableChinese: string;
  advancingJapanese: string;
  advancingChinese: string;
  isStale: boolean;
  staleReason: string | null;
  staleAt: string | null;
  selectedVariant: "STABLE" | "ADVANCING" | null;
  selectedAt: string | null;
  createdAt: string;
  translationPromptVersion?: string | null;
  generationPromptVersion?: string | null;
};

function getDraftStaleReasonLabel(value?: string | null) {
  const map: Record<string, string> = {
    "new-inbound-message": "顾客发来了更新消息，当前建议已过期。",
    "new-generation-generated": "已有更新版本建议，当前建议已过期。",
  };
  return value ? map[value] || value : "";
}

export function deriveDraftPresentation(latestDraft: ReplyDraftLike | null, latestCustomerMessageId: string | null) {
  const isUsed = !!latestDraft?.selectedVariant;
  const isStale =
    !!latestDraft?.isStale ||
    (!!latestDraft &&
      !!latestCustomerMessageId &&
      !!latestDraft.targetCustomerMessageId &&
      latestDraft.targetCustomerMessageId !== latestCustomerMessageId);
  const isBlocked = false;
  const shouldDimDraft = isUsed || isStale;
  const issues: string[] = [];

  const statusNote = isUsed
    ? `已使用：${latestDraft?.selectedVariant === "STABLE" ? "A 稳妥版" : "B 推进版"}`
    : isStale
      ? getDraftStaleReasonLabel(latestDraft?.staleReason) || "当前建议已过期，请基于最新上下文重新生成回复。"
      : "建议已生成。";

  const primaryActionLabel = "生成回复";

  const primaryActionHint = !latestDraft
    ? "当前还没有建议，点击生成回复后会给出两种回复方案。"
    : isStale
      ? "当前建议可能不是基于最新对话生成，请重新生成回复。"
      : "可重新生成回复，调整语气、推进力度或约束。";

  return {
    isUsed,
    isStale,
    isBlocked,
    shouldDimDraft,
    issues,
    statusNote,
    primaryActionLabel,
    primaryActionHint,
  };
}
