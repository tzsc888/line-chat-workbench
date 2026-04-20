import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAnalysisStrategy,
  resolveFollowupStrategy,
  resolveGenerationStrategy,
  resolveReviewStrategy,
  resolveTranslationStrategy,
  resolveWorkflowPolicyStrategy,
} from "../../lib/ai/strategy";

test("strategy resolvers expose module-scoped configs with same version", () => {
  const translation = resolveTranslationStrategy();
  const analysis = resolveAnalysisStrategy();
  const generation = resolveGenerationStrategy();
  const review = resolveReviewStrategy();
  const workflow = resolveWorkflowPolicyStrategy();
  const followup = resolveFollowupStrategy();

  assert.equal(typeof translation.temperature, "number");
  assert.ok(analysis.coreSalesRules.length >= 1);
  assert.ok(generation.styleRules.length >= 1);
  assert.ok(review.criticalRules.length >= 1);
  assert.equal(workflow.reuseDraft.onlyAutoMode, true);
  assert.equal(followup.timingDays.in3Days, 3);

  const versions = new Set([
    translation.strategyVersion,
    analysis.strategyVersion,
    generation.strategyVersion,
    review.strategyVersion,
    workflow.strategyVersion,
    followup.strategyVersion,
  ]);
  assert.equal(versions.size, 1);
});
