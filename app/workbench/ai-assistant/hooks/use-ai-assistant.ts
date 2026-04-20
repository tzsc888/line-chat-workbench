import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSource } from "@prisma/client";
import { deriveDraftPresentation } from "@/lib/ai/draft-presentation";

type RewriteResult = {
  suggestion1Ja: string;
  suggestion1Zh: string;
  suggestion2Ja: string;
  suggestion2Zh: string;
};

type ReplyDraftSetLike = {
  id: string;
  targetCustomerMessageId: string | null;
  stableJapanese: string;
  stableChinese: string;
  advancingJapanese: string;
  advancingChinese: string;
  analysisPromptVersion: string | null;
  generationPromptVersion: string | null;
  reviewPromptVersion: string | null;
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
};

type WorkspaceLike = {
  customer: {
    id: string;
  };
  latestCustomerMessageId: string | null;
  latestReplyDraftSet: ReplyDraftSetLike | null;
};

type SubmitOutboundMessageInput = {
  customerId: string;
  japaneseText: string;
  chineseText?: string | null;
  imageUrl?: string | null;
  stickerPackageId?: string | null;
  stickerId?: string | null;
  type: "TEXT" | "IMAGE" | "STICKER";
  source: MessageSource;
  replyDraftSetId?: string;
  suggestionVariant?: "STABLE" | "ADVANCING";
  optimisticMessageId?: string;
};

function readErrorMessage(input: unknown) {
  if (!input) return "";
  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  if (typeof input === "object" && input && "error" in input && typeof (input as { error?: unknown }).error === "string") {
    return (input as { error: string }).error;
  }
  return String(input || "");
}

function readStructuredMeta(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = input as {
    errorCode?: unknown;
    stage?: unknown;
    mode?: unknown;
  };
  const errorCode = typeof value.errorCode === "string" ? value.errorCode : "";
  const stage = typeof value.stage === "string" ? value.stage : "";
  const mode = typeof value.mode === "string" ? value.mode : "";
  if (!errorCode && !stage && !mode) return null;
  return { errorCode, stage, mode };
}

export function formatGenerateRepliesError(error: unknown) {
  const structuredMeta = readStructuredMeta(error);
  if (structuredMeta?.errorCode) {
    if (structuredMeta.errorCode === "MODEL_JSON_PARSE_ERROR") {
      return "Generation failed: model returned malformed JSON content. Please retry.";
    }
    if (structuredMeta.errorCode === "MODEL_TIMEOUT") {
      return "Generation timed out before getting valid structured output. Please retry.";
    }
    const stageText = structuredMeta.stage || "generation";
    const modeText = structuredMeta.mode ? ` (${structuredMeta.mode})` : "";
    return `Generation failed at ${stageText}${modeText}: ${structuredMeta.errorCode}.`;
  }

  const raw = readErrorMessage(error);
  const normalized = raw.replace(/^error:\s*/i, "").trim();
  if (normalized.includes("generation_missing_chinese_meaning")) {
    return "Generation failed: Chinese explanation is missing. Please retry.";
  }
  if (normalized.includes("generation_missing_japanese_reply")) {
    return "Generation failed: Japanese reply content is missing. Please retry.";
  }
  if (normalized.includes("generation_empty_reply")) {
    return "Generation failed: AI returned empty suggestions. Please retry.";
  }
  return normalized || "Generation failed: unknown error.";
}

export function useAiAssistant(input: {
  selectedCustomerId: string;
  workspace: WorkspaceLike | null;
  loadWorkspace: (customerId: string, options?: { preserveUi?: boolean }) => Promise<void>;
  loadCustomers: (options?: { preserveUi?: boolean }) => Promise<void>;
  submitOutboundMessage: (params: SubmitOutboundMessageInput) => Promise<{ ok: boolean }>;
}) {
  const [rewriteInput, setRewriteInput] = useState("");
  const [customReply, setCustomReply] = useState<RewriteResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSendingAi, setIsSendingAi] = useState<"stable" | "advancing" | "">("");
  const [apiError, setApiError] = useState("");
  const [helperError, setHelperError] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const rewriteInFlightRef = useRef(false);

  const displayedSuggestion1Ja =
    customReply?.suggestion1Ja ||
    input.workspace?.latestReplyDraftSet?.stableJapanese ||
    "";
  const displayedSuggestion1Zh =
    customReply?.suggestion1Zh ||
    input.workspace?.latestReplyDraftSet?.stableChinese ||
    "";
  const displayedSuggestion2Ja =
    customReply?.suggestion2Ja ||
    input.workspace?.latestReplyDraftSet?.advancingJapanese ||
    "";
  const displayedSuggestion2Zh =
    customReply?.suggestion2Zh ||
    input.workspace?.latestReplyDraftSet?.advancingChinese ||
    "";
  const latestDraft = input.workspace?.latestReplyDraftSet || null;

  const draftPresentation = useMemo(
    () => deriveDraftPresentation(latestDraft, input.workspace?.latestCustomerMessageId || null),
    [latestDraft, input.workspace?.latestCustomerMessageId],
  );

  useEffect(() => {
    setCustomReply(null);
    setAiNotice("");
  }, [input.selectedCustomerId, input.workspace?.latestReplyDraftSet?.id, input.workspace?.latestCustomerMessageId]);

  const resetForHardLoad = useCallback(() => {
    setRewriteInput("");
    setCustomReply(null);
    setApiError("");
    setHelperError("");
    setAiNotice("");
  }, []);

  const handleRewrite = useCallback(async () => {
    if (rewriteInFlightRef.current) return;
    if (!input.workspace) {
      window.alert("No customer selected.");
      return;
    }
    try {
      rewriteInFlightRef.current = true;
      setIsGenerating(true);
      setApiError("");
      setAiNotice("");
      setCustomReply(null);
      const response = await fetch("/api/generate-replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: input.workspace.customer.id,
          rewriteInput,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(formatGenerateRepliesError(data));
      }
      setCustomReply({
        suggestion1Ja: data.suggestion1Ja || "",
        suggestion1Zh: data.suggestion1Zh || "",
        suggestion2Ja: data.suggestion2Ja || "",
        suggestion2Zh: data.suggestion2Zh || "",
      });
      setAiNotice("");
      setRewriteInput("");
      const customerId = input.workspace.customer.id;
      void (async () => {
        const [workspaceResult, customersResult] = await Promise.allSettled([
          input.loadWorkspace(customerId, { preserveUi: true }),
          input.loadCustomers({ preserveUi: true }),
        ]);
        const hasFailure = [workspaceResult, customersResult].some((result) => result.status === "rejected");
        if (hasFailure) {
          const nonAbortFailure = [workspaceResult, customersResult].some((result) => {
            if (result.status !== "rejected") return false;
            const reason = result.reason;
            return !(reason instanceof DOMException && reason.name === "AbortError") &&
              !(reason instanceof Error && reason.name === "AbortError");
          });
          if (nonAbortFailure) {
            setAiNotice("Suggestions are ready. Background sync failed and will retry later.");
          }
        }
      })();
    } catch (error) {
      console.error(error);
      const message = formatGenerateRepliesError(error);
      setApiError(message);
      window.alert(message);
    } finally {
      rewriteInFlightRef.current = false;
      setIsGenerating(false);
    }
  }, [input, rewriteInput]);

  const handleAnalyzeCustomer = useCallback(async () => {
    if (!input.workspace) {
      window.alert("No customer selected.");
      return;
    }
    try {
      setIsAnalyzing(true);
      setHelperError("");
      setAiNotice("");
      setCustomReply(null);
      const response = await fetch("/api/analyze-customer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: input.workspace.customer.id,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "analyze_failed");
      }
      setAiNotice("Analysis refreshed.");
      await input.loadWorkspace(input.workspace.customer.id);
      await input.loadCustomers({ preserveUi: true });
    } catch (error) {
      console.error(error);
      setHelperError(String(error));
      window.alert("Analysis refresh failed. Check the error panel.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [input]);

  const sendAiReply = useCallback(
    async (variant: "stable" | "advancing") => {
      if (!input.workspace) {
        window.alert("No customer selected.");
        return;
      }
      const replyJa = variant === "stable" ? displayedSuggestion1Ja : displayedSuggestion2Ja;
      const replyZh = variant === "stable" ? displayedSuggestion1Zh : displayedSuggestion2Zh;
      if (!replyJa.trim()) {
        window.alert("No suggestion available to send.");
        return;
      }
      try {
        setIsSendingAi(variant);
        setCustomReply(null);
        await input.submitOutboundMessage({
          customerId: input.workspace.customer.id,
          japaneseText: replyJa,
          chineseText: replyZh,
          source: "AI_SUGGESTION",
          type: "TEXT",
          replyDraftSetId: input.workspace.latestReplyDraftSet?.id || "",
          suggestionVariant: variant === "stable" ? "STABLE" : "ADVANCING",
        });
      } catch (error) {
        console.error(error);
      } finally {
        setIsSendingAi("");
      }
    },
    [displayedSuggestion1Ja, displayedSuggestion1Zh, displayedSuggestion2Ja, displayedSuggestion2Zh, input],
  );

  return {
    state: {
      rewriteInput,
      isGenerating,
      isAnalyzing,
      isSendingAi,
      apiError,
      helperError,
      aiNotice,
    },
    derived: {
      latestDraft,
      latestDraftGenerationBrief: draftPresentation.generationBrief,
      latestDraftReviewFlags: draftPresentation.reviewFlags,
      latestDraftAiReview: draftPresentation.aiReview,
      latestDraftSelfCheck: draftPresentation.selfCheck,
      latestDraftIssues: draftPresentation.issues,
      latestDraftStatusNote: draftPresentation.statusNote,
      latestDraftReviewSummary: draftPresentation.reviewSummary,
      latestDraftPrimaryActionLabel: draftPresentation.primaryActionLabel,
      latestDraftPrimaryActionHint: draftPresentation.primaryActionHint,
      isLatestDraftUsed: draftPresentation.isUsed,
      isLatestDraftStale: draftPresentation.isStale,
      isLatestDraftBlocked: draftPresentation.isBlocked,
      shouldDimDraft: draftPresentation.shouldDimDraft,
      displayedSuggestion1Ja,
      displayedSuggestion1Zh,
      displayedSuggestion2Ja,
      displayedSuggestion2Zh,
    },
    actions: {
      setRewriteInput,
      handleAnalyzeCustomer,
      handleRewrite,
      sendStableSuggestion: () => sendAiReply("stable"),
      sendAdvancingSuggestion: () => sendAiReply("advancing"),
      resetForHardLoad,
    },
  };
}

