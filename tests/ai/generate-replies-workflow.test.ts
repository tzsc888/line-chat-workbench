import test from "node:test";
import assert from "node:assert/strict";
import { executeGenerateRepliesWorkflow, type GenerateRepliesWorkflowDeps } from "../../lib/services/generate-replies-workflow-core";

function buildGenerationParsed() {
  return {
    reply_a_ja: "A-ja",
    reply_b_ja: "B-ja",
  };
}

function createDeps(overrides?: Partial<GenerateRepliesWorkflowDeps>): GenerateRepliesWorkflowDeps {
  const latestMessage = {
    id: "m-latest",
    role: "CUSTOMER" as const,
    type: "TEXT" as const,
    source: "LINE" as const,
    japaneseText: "hello-ja",
    chineseText: "hello-zh",
    sentAt: new Date("2026-04-20T00:00:00.000Z"),
  };

  const base: GenerateRepliesWorkflowDeps = {
    findCustomerById: async () => ({
      id: "c-1",
      remarkName: "customer-1",
      originalName: "customer-1",
      stage: "NEW_LEAD",
      messages: [latestMessage],
      replyDraftSets: [],
    }),
    updateMessageChineseText: async () => {},
    publishRealtimeRefresh: async () => ({}),
    buildMainBrainGenerationContext: () => ({ ok: true }),
    runReplyGeneration: async () => ({
      line: "generation-ok",
      model: "gen-model",
      parsed: buildGenerationParsed(),
      promptVersion: "gen-v2",
    }),
    translateCustomerJapaneseMessage: async () => ({
      line: "translation-ok",
      model: "trans-model",
      parsed: {
        translation: "hello-zh",
      },
      promptVersion: "translation-v1",
    }),
    translateGeneratedReplies: async () => ({
      line: "translation-ok",
      model: "trans-model",
      parsed: {
        reply_a_zh: "A-zh",
        reply_b_zh: "B-zh",
      },
      promptVersion: "translation-v1-reply",
    }),
    saveDraftBundle: async () => ({ id: "draft-new" }),
    shouldReuseExistingDraft: () => false,
  };

  return { ...base, ...overrides };
}

test("manual generate should run generation and return two suggestions", async () => {
  let generationCalled = false;
  let replyTranslationCalled = false;
  let saveCalled = false;
  const deps = createDeps({
    runReplyGeneration: async () => {
      generationCalled = true;
      return {
        line: "generation-ok",
        model: "gen-model",
        parsed: buildGenerationParsed(),
        promptVersion: "gen-v2",
      };
    },
    translateGeneratedReplies: async () => {
      replyTranslationCalled = true;
      return {
        line: "translation-ok",
        model: "trans-model",
        parsed: {
          reply_a_zh: "A-zh",
          reply_b_zh: "B-zh",
        },
        promptVersion: "translation-v1-reply",
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
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.suggestion1Ja, "A-ja");
  assert.equal(result.suggestion1Zh, "A-zh");
  assert.equal(result.suggestion2Ja, "B-ja");
  assert.equal(result.suggestion2Zh, "B-zh");
  assert.equal(result.triggerSource, "MANUAL_GENERATE");
  assert.equal(generationCalled, true);
  assert.equal(replyTranslationCalled, true);
  assert.equal(saveCalled, true);
});

test("auto mode may reuse existing draft", async () => {
  const deps = createDeps({
    findCustomerById: async () => ({
      id: "c-1",
      remarkName: "customer-1",
      originalName: "customer-1",
      stage: "NEW_LEAD",
      messages: [
        {
          id: "m-latest",
          role: "CUSTOMER",
          type: "TEXT",
          source: "LINE",
          japaneseText: "hello-ja",
          chineseText: "hello-zh",
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
          stableJapanese: "old-a-ja",
          stableChinese: "old-a-zh",
          advancingJapanese: "old-b-ja",
          advancingChinese: "old-b-zh",
        },
      ],
    }),
    shouldReuseExistingDraft: () => true,
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
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.reusedExistingDraft, true);
  assert.equal(result.suggestion1Ja, "old-a-ja");
  assert.equal(result.triggerSource, "AUTO_FIRST_INBOUND");
});

test("workflow should throw generation_missing_japanese_reply when generation japanese output is empty", async () => {
  const deps = createDeps({
    runReplyGeneration: async () => ({
      line: "generation-empty",
      model: "gen-model",
      parsed: {
        ...buildGenerationParsed(),
        reply_a_ja: "   ",
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
        deps,
      ),
    /generation_missing_japanese_reply/,
  );
});

test("workflow should keep success when reply translation is empty", async () => {
  const deps = createDeps({
    translateGeneratedReplies: async () => ({
      line: "translation-empty",
      model: "trans-model",
      parsed: {
        reply_a_zh: " ",
        reply_b_zh: "B-zh",
      },
      promptVersion: "translation-v1-reply",
    }),
  });

  const result = await executeGenerateRepliesWorkflow(
    {
      customerId: "c-1",
      triggerSource: "MANUAL_GENERATE",
      autoMode: false,
      publishRefresh: false,
    },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.translationStatus, "failed");
  assert.equal(result.suggestion1Zh, "");
  assert.equal(result.suggestion2Zh, "");
});
