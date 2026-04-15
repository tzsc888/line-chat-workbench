import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import type { ContextMessage } from "@/lib/ai/ai-types";
import { buildAnalysisContext, buildGenerationContext, buildReviewContext } from "@/lib/ai/context-builder";
import { runAnalysisRouter } from "@/lib/ai/analysis-router-service";
import { runReplyGeneration } from "@/lib/ai/reply-generation-service";
import { buildReviewGate, runAiReview, runProgramChecks } from "@/lib/ai/reply-review-service";
import { applyAnalysisStateToCustomer } from "@/lib/ai/state-merge-service";
import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";
import { saveDraftBundle } from "@/lib/ai/draft-metadata-service";
import { shouldReuseExistingDraft, shouldRunAiReview } from "@/lib/ai/workflow-policy";

export async function generateRepliesWorkflow(input: {
  customerId: string;
  rewriteInput?: string;
  targetCustomerMessageId?: string | null;
  autoMode?: boolean;
  publishRefresh?: boolean;
}) {
  const customerId = String(input.customerId || "").trim();
  const rewriteInput = String(input.rewriteInput || "").trim();
  const requestedTargetMessageId = String(input.targetCustomerMessageId || "").trim() || null;
  const autoMode = input.autoMode === true;
  const shouldPublish = input.publishRefresh !== false;

  if (!customerId) {
    throw new Error("缺少 customerId");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      tags: { include: { tag: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 40 },
      replyDraftSets: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!customer) {
    throw new Error("客户不存在");
  }

  const messages = [...customer.messages].reverse() as ContextMessage[];
  const latestCustomerMessage = requestedTargetMessageId
    ? messages.find((message) => message.id === requestedTargetMessageId)
    : [...messages].reverse().find((message) => message.role === "CUSTOMER" && message.type === "TEXT");

  if (!latestCustomerMessage || latestCustomerMessage.type !== "TEXT") {
    throw new Error("当前没有可生成建议的文本顾客消息");
  }

  const existingDraft = customer.replyDraftSets[0] ?? null;
  if (shouldReuseExistingDraft({
    autoMode,
    rewriteInput,
    hasExistingDraft: !!existingDraft,
    sameTargetMessage: existingDraft?.targetCustomerMessageId === latestCustomerMessage.id,
    alreadySelected: !!existingDraft?.selectedVariant,
    isStale: !!existingDraft?.isStale,
  })) {
    return {
      ok: true,
      line: "已存在当前有效建议，跳过重复生成",
      model: existingDraft.modelName,
      suggestion1Ja: existingDraft.stableJapanese,
      suggestion1Zh: existingDraft.stableChinese,
      suggestion2Ja: existingDraft.advancingJapanese,
      suggestion2Zh: existingDraft.advancingChinese,
      draftSetId: existingDraft.id,
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
    : await translateCustomerJapaneseMessage({
        japaneseText: latestCustomerMessage.japaneseText,
        previousJapanese: previousMessage?.japaneseText,
        previousChinese: previousMessage?.chineseText || undefined,
      });

  if (!latestCustomerMessage.chineseText && translation.parsed.translation) {
    await prisma.message.update({
      where: { id: latestCustomerMessage.id },
      data: { chineseText: translation.parsed.translation },
    });
    latestCustomerMessage.chineseText = translation.parsed.translation;
  }

  const analysisContext = buildAnalysisContext({
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

  const analysis = await runAnalysisRouter(analysisContext);

  await applyAnalysisStateToCustomer({
    customerId: customer.id,
    previousCustomerInfo: customer.aiCustomerInfo,
    previousStrategy: customer.aiCurrentStrategy,
    previousRiskTags: customer.riskTags,
    isVip: customer.isVip,
    analysis: analysis.parsed,
  });

  if (!analysis.parsed.routing_decision.should_generate_reply) {
    if (shouldPublish) {
      try {
        await publishRealtimeRefresh({ customerId: customer.id, reason: "analysis-updated" });
      } catch (error) {
        console.error("publish analysis-updated error:", error);
      }
    }
    return {
      ok: true,
      line: analysis.line,
      model: analysis.model,
      skipped: true,
      reason: analysis.parsed.routing_decision.route_reason || "当前局面不建议生成回复",
      analysis: analysis.parsed,
    };
  }

  const generationContext = buildGenerationContext({
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

  const generation = await runReplyGeneration(generationContext);
  const programChecks = runProgramChecks({ analysis: analysis.parsed, generation: generation.parsed });

  let aiReview = null as Awaited<ReturnType<typeof runAiReview>>["parsed"] | null;
  let aiReviewPromptVersion: string | null = null;
  if (
    shouldRunAiReview({
      vip: customer.isVip,
      analysisNeedsReview: analysis.parsed.review_flags.needs_ai_review,
      programNeedsReview: programChecks.needs_ai_review,
      confidence: analysis.parsed.review_flags.confidence,
      sceneType: analysis.parsed.scene_assessment.scene_type,
    })
  ) {
    const aiReviewResult = await runAiReview(
      buildReviewContext({
        analysis: analysis.parsed,
        generation: generation.parsed,
        latestMessage: latestCustomerMessage,
        translation: translation.parsed,
        deliveryContext: analysisContext.delivery_context,
        recentMessages: messages,
        customerStage: String(customer.stage),
      }),
    );
    aiReview = aiReviewResult.parsed;
    aiReviewPromptVersion = aiReviewResult.promptVersion;
  }

  const review = buildReviewGate(programChecks.issues, aiReview);

  const draftSet = await saveDraftBundle({
    customerId,
    targetCustomerMessageId: latestCustomerMessage.id,
    extraRequirement: rewriteInput || null,
    modelName: generation.model,
    translationPromptVersion: translation.promptVersion,
    analysisPromptVersion: analysis.promptVersion,
    generationPromptVersion: generation.promptVersion,
    reviewPromptVersion: aiReviewPromptVersion,
    analysis: analysis.parsed,
    generation: generation.parsed,
    review,
  });

  if (shouldPublish) {
    try {
      await publishRealtimeRefresh({ customerId: customer.id, reason: "reply-generated" });
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
    review,
    promptVersions: {
      translation: translation.promptVersion,
      analysis: analysis.promptVersion,
      generation: generation.promptVersion,
      review: aiReviewPromptVersion,
    },
  };
}
