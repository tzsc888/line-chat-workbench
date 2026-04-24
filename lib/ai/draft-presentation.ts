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
    "new-inbound-message": "Customer sent a newer message, draft is stale.",
    "new-generation-generated": "A newer draft was generated, current draft is stale.",
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
    ? `Selected: ${latestDraft?.selectedVariant === "STABLE" ? "A (safer)" : "B (more advancing)"}`
    : isStale
      ? getDraftStaleReasonLabel(latestDraft?.staleReason) || "Draft is stale, regenerate with latest context."
      : "Draft generated.";

  const primaryActionLabel = !latestDraft ? "Generate replies" : isStale ? "Regenerate on latest messages" : "Regenerate";

  const primaryActionHint = !latestDraft
    ? "No draft exists yet. Generate two reply options."
    : isStale
      ? "Current draft is outdated. Generate again with latest conversation."
      : "Regenerate to adjust tone, push strength, or constraints.";

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
