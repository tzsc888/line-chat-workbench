import type { ContextMessage } from "@/lib/ai/ai-types";
import { isAiStructuredOutputError } from "@/lib/ai/model-client";
import type { GenerateRepliesTriggerSource } from "@/lib/services/generate-replies-workflow";

export type GenerateRepliesWorkflowInput = {
  customerId: string;
  rewriteInput?: string;
  targetCustomerMessageId?: string | null;
  autoMode?: boolean;
  publishRefresh?: boolean;
  triggerSource?: GenerateRepliesTriggerSource;
};

export type GenerateRepliesWorkflowDeps = {
  findCustomerById: (customerId: string) => Promise<{
    id: string;
    remarkName: string | null;
    originalName: string;
    stage: string;
    aiCustomerInfo?: string | null;
    aiCurrentStrategy?: string | null;
    riskTags?: string[] | null;
    followupBucket?: string | null;
    followupTier?: string | null;
    followupState?: string | null;
    followupReason?: string | null;
    nextFollowupAt?: Date | null;
    tags?: Array<{ tag: { name: string } }> | null;
    messages: ContextMessage[];
    replyDraftSets: Array<{
      id: string;
      targetCustomerMessageId: string | null;
      selectedVariant: "STABLE" | "ADVANCING" | null;
      isStale: boolean;
      modelName: string;
      stableJapanese: string;
      stableChinese: string;
      advancingJapanese: string;
      advancingChinese: string;
    }>;
  } | null>;
  updateMessageChineseText: (messageId: string, chineseText: string) => Promise<void>;
  getMessageChineseText?: (messageId: string) => Promise<string | null>;
  publishRealtimeRefresh: (params: { customerId: string; reason: string }) => Promise<unknown>;
  buildMainBrainGenerationContext: (input: Record<string, unknown>) => Record<string, unknown>;
  runReplyGeneration: (context: Record<string, unknown>) => Promise<{
    line: string;
    model: string;
    parsed: {
      reply_ja: string;
    };
    promptVersion: string;
  }>;
  translateCustomerJapaneseMessage: (input: {
    japaneseText: string;
    previousJapanese?: string;
    previousChinese?: string;
  }) => Promise<{
    line: string;
    model: string;
    parsed: {
      translation: string;
    };
    promptVersion: string;
  }>;
  translateGeneratedReply: (input: {
    replyJa: string;
  }) => Promise<{
    line: string;
    model: string;
    parsed: {
      reply_zh: string;
    };
    promptVersion: string;
  }>;
  saveDraftBundle: (input: Record<string, unknown>) => Promise<{ id: string }>;
  shouldReuseExistingDraft: (input: {
    autoMode: boolean;
    rewriteInput: string;
    hasExistingDraft: boolean;
    sameTargetMessage: boolean;
    alreadySelected: boolean;
    isStale: boolean;
  }) => boolean;
};

type ReplyStage = "generation" | "translation";

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function safeSnippet(value: unknown, max = 700) {
  return String(value || "").replace(/\s+/g, " ").slice(0, max);
}

function resolveLatestCustomerMessageForTurn(messagesAsc: ContextMessage[], requestedTargetMessageId: string | null) {
  const latestCustomerAny = [...messagesAsc].reverse().find((message) => message.role === "CUSTOMER") || null;
  if (!requestedTargetMessageId) return latestCustomerAny;
  const requested = messagesAsc.find((message) => message.id === requestedTargetMessageId);
  if (!requested || requested.role !== "CUSTOMER") return latestCustomerAny;
  const requestedIndex = messagesAsc.findIndex((message) => message.id === requested.id);
  if (requestedIndex < 0) return latestCustomerAny;
  let latestInSameTurn = requested;
  for (let i = requestedIndex + 1; i < messagesAsc.length; i += 1) {
    const message = messagesAsc[i];
    if (message.role === "OPERATOR") break;
    if (message.role === "CUSTOMER") latestInSameTurn = message;
  }
  return latestInSameTurn;
}

function buildFailureSummary(details: Record<string, unknown> | null) {
  if (!details) return "";
  const parts = [
    `code=${String(details.structured_error_code || details.failed_code || "")}`,
    `causeCode=${String(details.structured_error_code || "")}`,
    `failureReason=${String(details.failure_reason || "")}`,
    `parsePhase=${String(details.parse_phase || "")}`,
    `elapsedMs=${String(details.elapsed_ms || details.total_elapsed_ms || "")}`,
    `providerElapsedMs=${String(details.provider_elapsed_ms || "")}`,
    `retryable=${String(details.retryable || "")}`,
    `providerRole=${String(details.provider_role || "")}`,
    `providerAttempt=${String(details.provider_attempt || "")}`,
    `providerMaxAttempts=${String(details.provider_max_attempts || "")}`,
    `httpStatus=${String(details.structured_status || "")}`,
    `contentType=${String(details.content_type || "")}`,
    `finalUrlHostAndPath=${String(details.final_url_host_and_path || "")}`,
    `responseFormatSent=${String(details.response_format_sent || "")}`,
    `streamSent=${String(details.stream_sent || "")}`,
    `fetchErrorName=${String(details.fetch_error_name || "")}`,
    `fetchErrorMessage=${safeSnippet(details.fetch_error_message || "", 240)}`,
    `fetchCauseName=${String(details.fetch_cause_name || "")}`,
    `fetchCauseCode=${String(details.fetch_cause_code || "")}`,
    `fetchCauseMessage=${safeSnippet(details.fetch_cause_message || "", 240)}`,
    `bodySnippet=${safeSnippet(details.upstream_body_snippet || "", 700)}`,
    `modelContentSnippet=${safeSnippet(details.model_content_snippet || "", 700)}`,
  ];
  return parts.join(" ");
}

export class GenerateRepliesStageError extends Error {
  stage: ReplyStage;
  code: string;
  elapsedMs: number;
  retryable: boolean;
  details: Record<string, unknown> | null;

  constructor(input: {
    stage: ReplyStage;
    code: string;
    message: string;
    elapsedMs: number;
    retryable: boolean;
    details?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "GenerateRepliesStageError";
    this.stage = input.stage;
    this.code = input.code;
    this.elapsedMs = input.elapsedMs;
    this.retryable = input.retryable;
    this.details = input.details || null;
  }
}

function buildStageError(stage: ReplyStage, error: unknown, startedAt: number) {
  const elapsed = elapsedMs(startedAt);
  if (isAiStructuredOutputError(error)) {
    const isTimeout = error.code === "MODEL_TIMEOUT";
    return new GenerateRepliesStageError({
      stage,
      code: isTimeout ? `${stage}_structured_timeout` : `${stage}_structured_failed`,
      message: `${stage} structured failure: ${error.code}`,
      elapsedMs: elapsed,
      retryable: isTimeout || error.code === "MODEL_HTTP_ERROR",
      details: {
        elapsed_ms: elapsed,
        structured_error_code: error.code,
        structured_stage: error.stage,
        structured_mode: error.mode,
        structured_status: error.status,
        failure_reason: error.failureReason,
        parse_phase: error.parsePhase,
        provider_elapsed_ms: error.providerElapsedMs,
        timeout_ms: error.timeoutMs,
        retryable: error.retryable,
        provider_role: error.providerRole,
        provider_attempt: error.attempt,
        provider_max_attempts: error.maxAttempts,
        content_type: error.contentType,
        final_url_host_and_path: error.finalUrlHostAndPath,
        response_format_sent: error.responseFormatSent,
        stream_sent: error.streamSent,
        fetch_error_name: error.fetchErrorName,
        fetch_error_message: error.fetchErrorMessage,
        fetch_cause_name: error.fetchCauseName,
        fetch_cause_code: error.fetchCauseCode,
        fetch_cause_message: error.fetchCauseMessage,
        upstream_body_snippet: safeSnippet(error.upstreamBodySnippet || error.snippet || "", 700),
        model_content_snippet: safeSnippet(error.modelContentSnippet || "", 700),
        top_level_keys: error.topLevelKeys,
        choices_length: error.choicesLength,
        sse_event_count: error.sseEventCount,
        assembled_content_length: error.assembledContentLength,
        structured_details: [...(error.details || [])],
      },
    });
  }

  const errorWithCode =
    error && typeof error === "object" ? (error as { code?: unknown; details?: unknown; message?: unknown }) : null;
  const explicitCode = typeof errorWithCode?.code === "string" ? errorWithCode.code : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedCode =
    explicitCode ||
    (stage === "translation" && message.startsWith("translation_") ? message : `${stage}_failed`);

  return new GenerateRepliesStageError({
    stage,
    code: normalizedCode,
    message: `${stage} failed: ${message || "unknown_error"}`,
    elapsedMs: elapsed,
    retryable: true,
    details: {
      elapsed_ms: elapsed,
      ...(errorWithCode && typeof errorWithCode.details === "object" && errorWithCode.details
        ? (errorWithCode.details as Record<string, unknown>)
        : {}),
    },
  });
}

export async function executeGenerateRepliesWorkflow(
  input: GenerateRepliesWorkflowInput,
  deps: GenerateRepliesWorkflowDeps,
) {
  const workflowStartedAt = Date.now();
  const customerId = String(input.customerId || "").trim();
  const rewriteInput = String(input.rewriteInput || "").trim();
  const requestedTargetMessageId = String(input.targetCustomerMessageId || "").trim() || null;
  const autoMode = input.autoMode === true;
  const shouldPublish = input.publishRefresh !== false;
  const triggerSource: GenerateRepliesTriggerSource = input.triggerSource || "MANUAL_GENERATE";

  if (!customerId) {
    throw new Error("missing customerId");
  }
  console.info(`[generate-replies] started customer=${customerId}`);

  const customer = await deps.findCustomerById(customerId);
  if (!customer) {
    throw new Error("customer_not_found");
  }

  const messages = [...customer.messages] as ContextMessage[];
  const latestCustomerMessage = resolveLatestCustomerMessageForTurn(messages, requestedTargetMessageId);

  if (!latestCustomerMessage) {
    throw new Error("target_customer_message_not_found");
  }

  const latestCustomerTextMessage =
    latestCustomerMessage.type === "TEXT"
      ? latestCustomerMessage
      : [...messages]
          .reverse()
          .find(
            (message) =>
              message.role === "CUSTOMER" &&
              message.type === "TEXT" &&
              new Date(message.sentAt || 0).getTime() <= new Date(latestCustomerMessage.sentAt || 0).getTime(),
          ) || null;

  const existingDraft = customer.replyDraftSets[0] ?? null;
  if (
    deps.shouldReuseExistingDraft({
      autoMode,
      rewriteInput,
      hasExistingDraft: !!existingDraft,
      sameTargetMessage: existingDraft?.targetCustomerMessageId === latestCustomerMessage.id,
      alreadySelected: !!existingDraft?.selectedVariant,
      isStale: !!existingDraft?.isStale,
    })
  ) {
    return {
      ok: true,
      reusedExistingDraft: true,
      line: "reused-existing-draft",
      model: existingDraft.modelName,
      suggestion1Ja: existingDraft.stableJapanese,
      suggestion1Zh: existingDraft.stableChinese,
      suggestion2Ja: existingDraft.advancingJapanese,
      suggestion2Zh: existingDraft.advancingChinese,
      draftSetId: existingDraft.id,
      triggerSource,
    };
  }

  const previousMessage = [...messages].reverse().find((message) => message.id !== latestCustomerMessage.id);
  const latestChineseFromDb =
    latestCustomerTextMessage && !latestCustomerTextMessage.chineseText?.trim() && deps.getMessageChineseText
      ? String((await deps.getMessageChineseText(latestCustomerTextMessage.id)) || "").trim()
      : "";

  if (latestCustomerTextMessage && latestChineseFromDb) {
    latestCustomerTextMessage.chineseText = latestChineseFromDb;
  }

  const translation = latestCustomerTextMessage?.chineseText?.trim()
      ? {
        line: "reuse-existing-translation",
        parsed: {
          translation: latestCustomerTextMessage.chineseText,
        },
        model: process.env.DEEPLX_CHAT_MODEL_SHORT || process.env.DEEPLX_REPLY_MODEL || "",
        promptVersion: "reuse-existing-translation-v1",
      }
    : latestCustomerTextMessage
      ? await deps.translateCustomerJapaneseMessage({
          japaneseText: latestCustomerTextMessage.japaneseText,
          previousJapanese: previousMessage?.japaneseText,
          previousChinese: previousMessage?.chineseText || undefined,
        })
      : {
          line: "skip-non-text-latest-customer-message",
          model: "",
          promptVersion: "skip-non-text-v1",
          parsed: { translation: "" },
        };

  if (latestCustomerTextMessage && !latestCustomerTextMessage.chineseText && translation.parsed.translation) {
    await deps.updateMessageChineseText(latestCustomerTextMessage.id, translation.parsed.translation);
    latestCustomerTextMessage.chineseText = translation.parsed.translation;
  }

  const diagnosticsContext = deps.buildMainBrainGenerationContext({
    customer: {
      id: customer.id,
      display_name: String(customer.remarkName || customer.originalName || "").trim(),
      stage: String(customer.stage),
      ai_customer_info: String(customer.aiCustomerInfo || "").trim(),
      ai_current_strategy: String(customer.aiCurrentStrategy || "").trim(),
      risk_tags: Array.isArray(customer.riskTags) ? customer.riskTags : [],
      followup: {
        bucket: customer.followupBucket || null,
        tier: customer.followupTier || null,
        state: customer.followupState || null,
        reason: customer.followupReason || null,
        next_followup_at: customer.nextFollowupAt ? customer.nextFollowupAt.toISOString() : null,
      },
      tags: Array.isArray(customer.tags) ? customer.tags.map((item) => item.tag.name) : [],
    },
    latestMessage: latestCustomerMessage,
    translation: translation.parsed,
    recentMessages: messages,
    rewriteInput,
    timelineWindowSize: 12,
  });

  // Conversation-first main model path:
  // Only send concrete chat primitives required by FINAL_PROMPT placeholders.
  // Keep legacy context-builder output for diagnostics/compat but never as model input.
  const generationContext = {
    latestMessage: latestCustomerMessage,
    recentMessages: messages,
    rewriteInput,
    debugMeta: diagnosticsContext,
  };

  const generationStartedAt = Date.now();
  console.info(`[generate-replies] generation started customer=${customerId}`);
  const generation = await deps
    .runReplyGeneration(generationContext)
    .then((result) => {
      console.info(
        `[generate-replies] generation finished customer=${customerId} elapsed_ms=${elapsedMs(generationStartedAt)}`,
      );
      return result;
    })
    .catch((error) => {
      const stageError = buildStageError("generation", error, generationStartedAt);
      console.error(
        `[generate-replies] generation failed customer=${customerId} code=${stageError.code} elapsed_ms=${stageError.elapsedMs}`,
      );
      if (stageError.details) {
        console.error(`[ai-generation-failure-summary] ${buildFailureSummary(stageError.details)}`);
      }
      throw stageError;
    });
  if (!generation.parsed.reply_ja.trim()) {
    throw new Error("generation_missing_japanese_reply");
  }

  const translationStartedAt = Date.now();
  console.info(`[generate-replies] translation started customer=${customerId}`);
  let translationStatus: "succeeded" | "failed" = "succeeded";
  let translationErrorCode = "";
  let translationErrorMessage = "";
  let replyTranslation: {
    parsed: {
      reply_zh: string;
    };
  } = {
    parsed: {
      reply_zh: "",
    },
  };
  try {
    const translated = await deps.translateGeneratedReply({
      replyJa: generation.parsed.reply_ja,
    });
    replyTranslation = translated;
    if (!translated.parsed.reply_zh.trim()) {
      translationStatus = "failed";
      translationErrorCode = "translation_missing_reply_meaning";
      translationErrorMessage = "translation returned empty reply meaning";
      replyTranslation = {
        parsed: {
          reply_zh: "",
        },
      };
      console.warn(
        `[generate-replies] translation degraded customer=${customerId} code=${translationErrorCode} elapsed_ms=${elapsedMs(translationStartedAt)}`,
      );
    } else {
      console.info(
        `[generate-replies] translation finished customer=${customerId} elapsed_ms=${elapsedMs(translationStartedAt)}`,
      );
    }
  } catch (error) {
    const stageError = buildStageError("translation", error, translationStartedAt);
    translationStatus = "failed";
    translationErrorCode = stageError.code;
    translationErrorMessage = stageError.message;
    replyTranslation = {
      parsed: {
        reply_zh: "",
      },
    };
    console.error(
      `[generate-replies] translation failed customer=${customerId} code=${stageError.code} elapsed_ms=${stageError.elapsedMs}`,
    );
  }

  const draftSet = await deps.saveDraftBundle({
    customerId,
    targetCustomerMessageId: latestCustomerMessage.id,
    extraRequirement: rewriteInput || null,
    modelName: generation.model,
    translationPromptVersion: translation.promptVersion,
    generationPromptVersion: generation.promptVersion,
    generation: {
      reply_ja: generation.parsed.reply_ja,
    },
    replyTranslation: replyTranslation.parsed,
  });

  if (shouldPublish) {
    try {
      await deps.publishRealtimeRefresh({ customerId: customer.id, reason: "reply-generated" });
    } catch (error) {
      console.error("publish reply-generated error:", error);
    }
  }

  console.info(
    `[generate-replies] workflow completed customer=${customerId} total_elapsed_ms=${elapsedMs(workflowStartedAt)}`,
  );

  return {
    ok: true,
    line: generation.line,
    model: generation.model,
    suggestion1Ja: generation.parsed.reply_ja,
    suggestion1Zh: replyTranslation.parsed.reply_zh,
    suggestion2Ja: "",
    suggestion2Zh: "",
    translationStatus,
    translationErrorCode,
    translationErrorMessage,
    draftSetId: draftSet.id,
    promptVersions: {
      translation: translation.promptVersion,
      generation: generation.promptVersion,
    },
    triggerSource,
  };
}

