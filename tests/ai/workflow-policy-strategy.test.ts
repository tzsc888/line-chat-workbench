import test from "node:test";
import assert from "node:assert/strict";
import { shouldReuseExistingDraft, shouldRunAiReview } from "../../lib/ai/workflow-policy";

test("workflow policy follows strategy defaults for reuse", () => {
  assert.equal(
    shouldReuseExistingDraft({
      autoMode: true,
      rewriteInput: "",
      hasExistingDraft: true,
      sameTargetMessage: true,
      alreadySelected: false,
      isStale: false,
    }),
    true,
  );

  assert.equal(
    shouldReuseExistingDraft({
      autoMode: true,
      rewriteInput: "need rewrite",
      hasExistingDraft: true,
      sameTargetMessage: true,
      alreadySelected: false,
      isStale: false,
    }),
    false,
  );
});

test("workflow review gate follows configured confidence and scene rules", () => {
  assert.equal(
    shouldRunAiReview({
      vip: false,
      analysisNeedsReview: false,
      programNeedsReview: false,
      confidence: "LOW",
      sceneType: "INITIAL_CONTACT",
    }),
    true,
  );

  assert.equal(
    shouldRunAiReview({
      vip: false,
      analysisNeedsReview: false,
      programNeedsReview: false,
      confidence: "HIGH",
      sceneType: "INITIAL_CONTACT",
    }),
    false,
  );
});
