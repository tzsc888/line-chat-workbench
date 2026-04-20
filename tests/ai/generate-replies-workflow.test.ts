import test from "node:test";
import assert from "node:assert/strict";
import { executeGenerateRepliesWorkflow } from "../../lib/services/generate-replies-workflow-core";

function buildAnalysisResult() {
  return {
    scene_assessment: {
      scene_type: "INITIAL_CONTACT",
      relationship_stage: "NEWLY_ADDED",
      latest_message_focus: "咨询",
      tone_attitude: "neutral",
      industry_stage: "POST_FREE_READING_CONVERSION",
      buyer_language: "ANSWER",
      interest_level: "MEDIUM",
      resistance_level: "LIGHT",
      reasoning: "basic",
    },
    routing_decision: {
      route_type: "LIGHT_HOLD",
      reply_goal: "先承接",
      route_reason: "首轮接待",
      conversion_window: "LIGHT",
    },
    followup_decision: {
      followup_tier: "B",
      followup_state: "ACTIVE",
      next_followup_bucket: "IN_1_DAY",
      followup_reason: "待跟进",
      should_update_followup: true,
    },
    generation_brief: {
      mission: "先回应关切",
      must_cover: ["已收到"],
      must_avoid: ["强推"],
      push_level: "LIGHT_HOLD",
      reply_length: "SHORT",
      style_notes: ["自然"],
      delivery_anchor: "首次咨询",
      conversion_step: "RECEIVE",
      boundary_to_establish: "先了解",
    },
    state_update: {
      customer_info_delta: ["首次咨询"],
      strategy_delta: ["保持承接"],
      stage_changed: false,
      risk_tags: [],
    },
    review_flags: {
      confidence: "MEDIUM",
      needs_ai_review: false,
      needs_human_attention: false,
      review_reason: "",
    },
  } as const;
}

function buildGenerationResult() {
  return {
    reply_a: {
      japanese: "A案",
      chinese_meaning: "A译",
      positioning: "SAFER",
    },
    reply_b: {
      japanese: "B案",
      chinese_meaning: "B译",
      positioning: "MORE_FORWARD_HALF_STEP",
    },
    difference_note: "A稳 B推进",
    self_check: {
      followed_route: true,
      followed_push_level: true,
      avoided_risks: [],
      length_control: "SHORT",
      notes: "",
    },
  } as const;
}

function createDeps(overrides?: Record<string, unknown>) {
  const latestMessage = {
    id: "m-latest",
    role: "CUSTOMER" as const,
    type: "TEXT" as const,
    source: "LINE" as const,
    japaneseText: "こんにちは",
    chineseText: "你好",
    sentAt: new Date("2026-04-20T00:00:00.000Z"),
  };

  const deps = {
    findCustomerById: async () => ({
      id: "c-1",
      remarkName: "客户1",
      originalName: "客户1",
      isVip: false,
      stage: "NEW_LEAD",
      aiCustomerInfo: null,
      aiCurrentStrategy: null,
      followupTier: "B",
      followupState: "ACTIVE",
      followupBucket: "UNCONVERTED",
      lineRelationshipStatus: "ACTIVE",
      riskTags: [],
      tags: [],
      messages: [latestMessage],
      replyDraftSets: [],
    }),
    updateMessageChineseText: async () => {},
    publishRealtimeRefresh: async () => ({}),
    buildAnalysisContext: () => ({ delivery_context: {}, latest_message: {} }),
    buildGenerationContext: () => ({}),
    runAnalysisRouter: async () => ({
      line: "analysis-ok",
      model: "analysis-model",
      parsed: buildAnalysisResult(),
      promptVersion: "analysis-v3",
    }),
    runReplyGeneration: async () => ({
      line: "generation-ok",
      model: "gen-model",
      parsed: buildGenerationResult(),
      promptVersion: "gen-v2",
    }),
    applyAnalysisStateToCustomer: async () => ({}),
    translateCustomerJapaneseMessage: async () => ({
      line: "translation-ok",
      model: "trans-model",
      parsed: {
        translation: "你好",
        tone_notes: "",
        ambiguity_notes: "",
        attention_points: [],
      },
      promptVersion: "translation-v1",
    }),
    saveDraftBundle: async () => ({ id: "draft-new" }),
    shouldReuseExistingDraft: () => false,
    getActiveAiStrategyVersion: () => "s2",
  };

  return {
    ...deps,
    ...overrides,
  };
}

test("manual generate should run analysis+generation and return two suggestions without no-reply skip semantics", async () => {
  let generationCalled = false;
  let saveCalled = false;
  const deps = createDeps({
    runReplyGeneration: async () => {
      generationCalled = true;
      return {
        line: "generation-ok",
        model: "gen-model",
        parsed: buildGenerationResult(),
        promptVersion: "gen-v2",
      };
    },
    saveDraftBundle: async () => {
      saveCalled = true;
      return { id: "draft-created" };
    },
  });

  const result = await executeGenerateRepliesWorkflow(
    {
      customerId: "c-1",
      triggerSource: "MANUAL_GENERATE",
      autoMode: false,
      publishRefresh: false,
    },
    deps as never,
  );

  assert.equal(result.ok, true);
  assert.equal(result.suggestion1Ja, "A案");
  assert.equal(result.suggestion1Zh, "A译");
  assert.equal(result.suggestion2Ja, "B案");
  assert.equal(result.suggestion2Zh, "B译");
  assert.equal(result.triggerSource, "MANUAL_GENERATE");
  assert.equal(generationCalled, true);
  assert.equal(saveCalled, true);
  assert.equal("skipped" in result, false);
  assert.equal(JSON.stringify(result).includes("analysis_decided_no_reply"), false);
});

test("auto mode may reuse existing draft and should not return no-reply skip", async () => {
  const deps = createDeps({
    findCustomerById: async () => ({
      id: "c-1",
      remarkName: "客户1",
      originalName: "客户1",
      isVip: false,
      stage: "NEW_LEAD",
      aiCustomerInfo: null,
      aiCurrentStrategy: null,
      followupTier: "B",
      followupState: "ACTIVE",
      followupBucket: "UNCONVERTED",
      lineRelationshipStatus: "ACTIVE",
      riskTags: [],
      tags: [],
      messages: [
        {
          id: "m-latest",
          role: "CUSTOMER",
          type: "TEXT",
          source: "LINE",
          japaneseText: "こんにちは",
          chineseText: "你好",
          sentAt: new Date("2026-04-20T00:00:00.000Z"),
        },
      ],
      replyDraftSets: [
        {
          id: "draft-old",
          targetCustomerMessageId: "m-latest",
          selectedVariant: null,
          isStale: false,
          modelName: "gen-model",
          stableJapanese: "旧A",
          stableChinese: "旧A译",
          advancingJapanese: "旧B",
          advancingChinese: "旧B译",
        },
      ],
    }),
    shouldReuseExistingDraft: () => true,
    runAnalysisRouter: async () => {
      throw new Error("should_not_call_analysis_when_reused");
    },
    runReplyGeneration: async () => {
      throw new Error("should_not_call_generation_when_reused");
    },
  });

  const result = await executeGenerateRepliesWorkflow(
    {
      customerId: "c-1",
      triggerSource: "AUTO_FIRST_INBOUND",
      autoMode: true,
      publishRefresh: false,
    },
    deps as never,
  );

  assert.equal(result.ok, true);
  assert.equal(result.reusedExistingDraft, true);
  assert.equal(result.suggestion1Ja, "旧A");
  assert.equal(result.triggerSource, "AUTO_FIRST_INBOUND");
  assert.equal("skipped" in result, false);
  assert.equal(JSON.stringify(result).includes("analysis_decided_no_reply"), false);
});

test("workflow should throw generation_missing_japanese_reply when generation japanese output is empty", async () => {
  const deps = createDeps({
    runReplyGeneration: async () => ({
      line: "generation-empty",
      model: "gen-model",
      parsed: {
        ...buildGenerationResult(),
        reply_a: { ...buildGenerationResult().reply_a, japanese: "   " },
      },
      promptVersion: "gen-v2",
    }),
  });

  await assert.rejects(
    () =>
      executeGenerateRepliesWorkflow(
        {
          customerId: "c-1",
          triggerSource: "MANUAL_GENERATE",
          autoMode: false,
          publishRefresh: false,
        },
        deps as never,
      ),
    /generation_missing_japanese_reply/,
  );
});

test("workflow should throw generation_missing_chinese_meaning when Chinese meanings are empty", async () => {
  const deps = createDeps({
    runReplyGeneration: async () => ({
      line: "generation-empty-zh",
      model: "gen-model",
      parsed: {
        ...buildGenerationResult(),
        reply_a: { ...buildGenerationResult().reply_a, chinese_meaning: " " },
      },
      promptVersion: "gen-v2",
    }),
  });

  await assert.rejects(
    () =>
      executeGenerateRepliesWorkflow(
        {
          customerId: "c-1",
          triggerSource: "MANUAL_GENERATE",
          autoMode: false,
          publishRefresh: false,
        },
        deps as never,
      ),
    /generation_missing_chinese_meaning/,
  );
});
