import test from "node:test";
import assert from "node:assert/strict";

import { shouldReuseExistingDraft, shouldRunAiReview } from "../../lib/ai/workflow-policy";
import { buildReviewPipelineResult } from "../../lib/ai/protocol-validator";

test("shouldReuseExistingDraft only reuses when auto mode hits same fresh unselected draft", () => {
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
      autoMode: false,
      rewriteInput: "",
      hasExistingDraft: true,
      sameTargetMessage: true,
      alreadySelected: false,
      isStale: false,
    }),
    false,
  );

  assert.equal(
    shouldReuseExistingDraft({
      autoMode: true,
      rewriteInput: "更稳一点",
      hasExistingDraft: true,
      sameTargetMessage: true,
      alreadySelected: false,
      isStale: false,
    }),
    false,
  );

  assert.equal(
    shouldReuseExistingDraft({
      autoMode: true,
      rewriteInput: "",
      hasExistingDraft: true,
      sameTargetMessage: false,
      alreadySelected: false,
      isStale: false,
    }),
    false,
  );
});

test("shouldRunAiReview escalates VIP low-confidence and objection scenes", () => {
  assert.equal(
    shouldRunAiReview({
      vip: true,
      analysisNeedsReview: false,
      programNeedsReview: false,
      confidence: "HIGH",
      sceneType: "INITIAL_CONTACT",
    }),
    true,
  );

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
      sceneType: "CLEAR_OBJECTION",
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

test("buildReviewPipelineResult blocks direct use when regenerate is recommended", () => {
  const result = buildReviewPipelineResult([], {
    overall_result: "REGENERATE",
    risk_level: "HIGH",
    issues_found: [
      {
        target: "both",
        issue_type: "stage_mismatch",
        severity: "HIGH",
        explanation: "阶段错位",
      },
    ],
    human_attention_note: "建议重生",
    regeneration_recommended: true,
  });

  assert.equal(result.final_gate.can_show_to_human, false);
  assert.equal(result.final_gate.can_recommend_direct_use, false);
  assert.equal(result.final_gate.should_highlight_warning, true);
});
