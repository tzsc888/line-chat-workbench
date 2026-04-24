import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGenerationReply,
  validateAnalysisResult,
  validateGenerationResult,
  validateAiReviewResult,
  validateMainBrainGenerationResult,
} from "../../lib/ai/protocol-validator";

test("validateAnalysisResult fills safe defaults", () => {
  const parsed = validateAnalysisResult({});
  assert.equal(parsed.generation_brief.push_level, "NO_PUSH");
  assert.equal(parsed.review_flags.confidence, "LOW");
  assert.equal(parsed.scene_assessment.industry_stage, "POST_FREE_READING_CONVERSION");
  assert.equal(parsed.scene_assessment.buyer_language, "UNKNOWN");
  assert.equal(parsed.routing_decision.conversion_window, "NONE");
  assert.equal(parsed.generation_brief.conversion_step, "RECEIVE");
});

test("validateMainBrainGenerationResult accepts flat JA shape", () => {
  const parsed = validateMainBrainGenerationResult({ reply_a_ja: "A", reply_b_ja: "B" });
  assert.equal(parsed.reply_a_ja, "A");
  assert.equal(parsed.reply_b_ja, "B");
});

test("normalizeGenerationReply accepts alias keys and normalizes shape", () => {
  const parsed = normalizeGenerationReply({
    replyAJa: "A-1",
    reply_b: "B-1",
    internal: "ignored",
  });
  assert.deepEqual(parsed, {
    reply_a_ja: "A-1",
    reply_b_ja: "B-1",
  });
});

test("validateGenerationResult keeps compatibility shape for legacy tests", () => {
  const parsed = validateGenerationResult({ reply_a_ja: "A", reply_b_ja: "B" });
  assert.equal(parsed.reply_a.positioning, "SAFER");
  assert.equal(parsed.reply_b.positioning, "MORE_FORWARD_HALF_STEP");
  assert.equal(parsed.reply_a.japanese, "A");
  assert.equal(parsed.reply_b.japanese, "B");
});

test("validateAiReviewResult normalizes invalid values", () => {
  const parsed = validateAiReviewResult({ overall_result: "BAD", risk_level: "X", issues_found: [{}] });
  assert.equal(parsed.overall_result, "PASS_WITH_NOTE");
  assert.equal(parsed.risk_level, "MEDIUM");
  assert.equal(parsed.issues_found.length, 1);
});
