import type { ContextMessage } from "@/lib/ai/ai-types";
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
    isVip: boolean;
    stage: string;
    aiCustomerInfo: string | null;
    aiCurrentStrategy: string | null;
    followupTier: string | null;
    followupState: string | null;
    followupBucket: string | null;
    lineRelationshipStatus: string;
    riskTags: string[];
    tags: Array<unknown>;
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
  publishRealtimeRefresh: (params: { customerId: string; reason: string }) => Promise<unknown>;
  buildAnalysisContext: (input: Record<string, unknown>) => {
    delivery_context: Record<string, unknown>;
  } & Record<string, unknown>;
  buildGenerationContext: (input: Record<string, unknown>) => Record<string, unknown>;
  runAnalysisRouter: (context: Record<string, unknown>) => Promise<{
    line: string;
    model: string;
    parsed: Record<string, any>;
    promptVersion: string;
  }>;
  runReplyGeneration: (context: Record<string, unknown>) => Promise<{
    line: string;
    model: string;
    parsed: {
      reply_a: { japanese: string; chinese_meaning: string };
      reply_b: { japanese: string; chinese_meaning: string };
      difference_note: string;
      self_check: Record<string, unknown>;
    };
    promptVersion: string;
  }>;
  applyAnalysisStateToCustomer: (input: Record<string, unknown>) => Promise<unknown>;
  translateCustomerJapaneseMessage: (input: {
    japaneseText: string;
    previousJapanese?: string;
    previousChinese?: string;
  }) => Promise<{
    line: string;
    model: string;
    parsed: {
      translation: string;
      tone_notes: string;
      ambiguity_notes: string;
      attention_points: string[];
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
  getActiveAiStrategyVersion: () => string;
};

export async function executeGenerateRepliesWorkflow(
  input: GenerateRepliesWorkflowInput,
  deps: GenerateRepliesWorkflowDeps,
) {
  const customerId = String(input.customerId || "").trim();
  const rewriteInput = String(input.rewriteInput || "").trim();
  const requestedTargetMessageId = String(input.targetCustomerMessageId || "").trim() || null;
  const autoMode = input.autoMode === true;
  const shouldPublish = input.publishRefresh !== false;
  const strategyVersion = deps.getActiveAiStrategyVersion();
  const triggerSource: GenerateRepliesTriggerSource = input.triggerSource || "MANUAL_GENERATE";

  if (!customerId) {
    throw new Error("missing customerId");
  }

  const customer = await deps.findCustomerById(customerId);
  if (!customer) {
    throw new Error("customer_not_found");
  }

  const messages = [...customer.messages].reverse() as ContextMessage[];
  const latestCustomerMessage = requestedTargetMessageId
    ? messages.find((message) => message.id === requestedTargetMessageId)
    : [...messages].reverse().find((message) => message.role === "CUSTOMER" && message.type === "TEXT");

  if (!latestCustomerMessage || latestCustomerMessage.type !== "TEXT") {
    throw new Error("target_customer_text_message_not_found");
  }

  const existingDraft = customer.replyDraftSets[0] ?? null;
  if (deps.shouldReuseExistingDraft({
    autoMode,
    rewriteInput,
    hasExistingDraft: !!existingDraft,
    sameTargetMessage: existingDraft?.targetCustomerMessageId === latestCustomerMessage.id,
    alreadySelected: !!existingDraft?.selectedVariant,
    isStale: !!existingDraft?.isStale,
  })) {
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
  const translation = latestCustomerMessage.chineseText?.trim()
    ? {
        line: "reuse-existing-translation",
        parsed: {
          translation: latestCustomerMessage.chineseText,
          tone_notes: "",
          ambiguity_notes: "",
          attention_points: [],
        },
        model: process.env.HELPER_MODEL || "",
        promptVersion: "reuse-existing-translation-v1",
      }
    : await deps.translateCustomerJapaneseMessage({
        japaneseText: latestCustomerMessage.japaneseText,
        previousJapanese: previousMessage?.japaneseText,
        previousChinese: previousMessage?.chineseText || undefined,
      });

  if (!latestCustomerMessage.chineseText && translation.parsed.translation) {
    await deps.updateMessageChineseText(latestCustomerMessage.id, translation.parsed.translation);
    latestCustomerMessage.chineseText = translation.parsed.translation;
  }

  const analysisContext = deps.buildAnalysisContext({
    customer: {
      id: customer.id,
      remarkName: customer.remarkName,
      originalName: customer.originalName,
      isVip: customer.isVip,
      stage: String(customer.stage),
      aiCustomerInfo: customer.aiCustomerInfo,
      aiCurrentStrategy: customer.aiCurrentStrategy,
      followupTier: customer.followupTier,
      followupState: customer.followupState,
      followupBucket: customer.followupBucket,
      lineRelationshipStatus: customer.lineRelationshipStatus,
      riskTags: customer.riskTags || [],
    },
    latestMessage: latestCustomerMessage,
    translation: translation.parsed,
    recentMessages: messages,
  });

  const analysis = await deps.runAnalysisRouter(analysisContext);

  await deps.applyAnalysisStateToCustomer({
    customerId: customer.id,
    previousCustomerInfo: customer.aiCustomerInfo,
    previousStrategy: customer.aiCurrentStrategy,
    previousRiskTags: customer.riskTags,
    isVip: customer.isVip,
    analysis: analysis.parsed,
  });

  const generationContext = deps.buildGenerationContext({
    deliveryContext: analysisContext.delivery_context,
    analysis: analysis.parsed,
    latestMessage: latestCustomerMessage,
    translation: translation.parsed,
    recentMessages: messages,
    customer: {
      stage: String(customer.stage),
      aiCurrentStrategy: customer.aiCurrentStrategy,
      riskTags: customer.riskTags || [],
      hasPurchased: customer.stage === "PAID" || customer.stage === "AFTER_SALES",
    },
  });

  const generation = await deps.runReplyGeneration(generationContext);
  if (!generation.parsed.reply_a.japanese.trim() || !generation.parsed.reply_b.japanese.trim()) {
    throw new Error("generation_missing_japanese_reply");
  }
  if (!generation.parsed.reply_a.chinese_meaning.trim() || !generation.parsed.reply_b.chinese_meaning.trim()) {
    throw new Error("generation_missing_chinese_meaning");
  }

  const draftSet = await deps.saveDraftBundle({
    customerId,
    targetCustomerMessageId: latestCustomerMessage.id,
    extraRequirement: rewriteInput || null,
    modelName: generation.model,
    translationPromptVersion: translation.promptVersion,
    analysisPromptVersion: analysis.promptVersion,
    generationPromptVersion: generation.promptVersion,
    reviewPromptVersion: null,
    strategyVersion,
    analysis: analysis.parsed,
    generation: generation.parsed,
  });

  if (shouldPublish) {
    try {
      await deps.publishRealtimeRefresh({ customerId: customer.id, reason: "reply-generated" });
    } catch (error) {
      console.error("publish reply-generated error:", error);
    }
  }

  return {
    ok: true,
    line: generation.line,
    model: generation.model,
    suggestion1Ja: generation.parsed.reply_a.japanese,
    suggestion1Zh: generation.parsed.reply_a.chinese_meaning,
    suggestion2Ja: generation.parsed.reply_b.japanese,
    suggestion2Zh: generation.parsed.reply_b.chinese_meaning,
    draftSetId: draftSet.id,
    analysis: analysis.parsed,
    promptVersions: {
      translation: translation.promptVersion,
      analysis: analysis.promptVersion,
      generation: generation.promptVersion,
      review: null,
    },
    strategyVersion,
    triggerSource,
  };
}
