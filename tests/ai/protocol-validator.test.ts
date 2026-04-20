import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysisResult, validateGenerationResult, validateAiReviewResult } from '../../lib/ai/protocol-validator';

test('validateAnalysisResult fills safe defaults', () => {
  const parsed = validateAnalysisResult({});
  assert.equal(parsed.generation_brief.push_level, 'NO_PUSH');
  assert.equal(parsed.review_flags.confidence, 'LOW');
  assert.equal(parsed.scene_assessment.industry_stage, 'POST_FREE_READING_CONVERSION');
  assert.equal(parsed.scene_assessment.buyer_language, 'UNKNOWN');
  assert.equal(parsed.routing_decision.conversion_window, 'NONE');
  assert.equal(parsed.generation_brief.conversion_step, 'RECEIVE');
});

test('validateGenerationResult enforces structural defaults', () => {
  const parsed = validateGenerationResult({ reply_a: {}, reply_b: {} });
  assert.equal(parsed.reply_a.positioning, 'SAFER');
  assert.equal(parsed.reply_b.positioning, 'MORE_FORWARD_HALF_STEP');
});

test('validateGenerationResult accepts chinese_explanation as compatibility alias', () => {
  const parsed = validateGenerationResult({
    reply_a: { japanese: "A", chinese_explanation: "A译" },
    reply_b: { japanese: "B", chinese_explanation: "B译" },
  });
  assert.equal(parsed.reply_a.chinese_meaning, "A译");
  assert.equal(parsed.reply_b.chinese_meaning, "B译");
});

test('validateAiReviewResult normalizes invalid values', () => {
  const parsed = validateAiReviewResult({ overall_result: 'BAD', risk_level: 'X', issues_found: [{}] });
  assert.equal(parsed.overall_result, 'PASS_WITH_NOTE');
  assert.equal(parsed.risk_level, 'MEDIUM');
  assert.equal(parsed.issues_found.length, 1);
});
