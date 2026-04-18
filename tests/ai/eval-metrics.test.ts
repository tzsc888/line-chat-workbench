import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAiEvalMetricsFromDrafts } from '../../lib/ai/metrics/eval-metrics-core';

test('computeAiEvalMetricsFromDrafts aggregates route scene risk and prompt breakdowns', () => {
  const metrics = computeAiEvalMetricsFromDrafts([
    {
      customerId: 'c1',
      routeType: 'LIGHT_HOLD',
      sceneType: 'INITIAL_CONTACT',
      pushLevel: 'LIGHT_HOLD',
      selectedVariant: 'STABLE',
      recommendedVariant: 'STABLE',
      isStale: false,
      staleReason: null,
      finalGateJson: JSON.stringify({ can_show_to_human: true }),
      reviewFlagsJson: JSON.stringify({ needs_human_attention: false, confidence: 'HIGH' }),
      aiReviewJson: JSON.stringify({ overall_result: 'PASS', risk_level: 'LOW', issues_found: [] }),
      analysisPromptVersion: 'analysis-v1',
      generationPromptVersion: 'generation-v1',
      reviewPromptVersion: 'review-v1',
      translationPromptVersion: 'translation-v1',
    },
    {
      customerId: 'c1',
      routeType: 'OBJECTION_HANDLING',
      sceneType: 'CLEAR_OBJECTION',
      pushLevel: 'NO_PUSH',
      selectedVariant: null,
      recommendedVariant: null,
      isStale: true,
      staleReason: 'new-analysis-generated',
      finalGateJson: JSON.stringify({ can_show_to_human: false }),
      reviewFlagsJson: JSON.stringify({ needs_human_attention: true, confidence: 'LOW' }),
      aiReviewJson: JSON.stringify({ overall_result: 'REGENERATE', risk_level: 'HIGH', issues_found: [{ issue_type: 'OVER_PUSH' }] }),
      analysisPromptVersion: 'analysis-v1',
      generationPromptVersion: 'generation-v2',
      reviewPromptVersion: 'review-v2',
      translationPromptVersion: 'translation-v1',
    },
  ], 14);

  assert.equal(metrics.totals.totalDrafts, 2);
  assert.equal(metrics.totals.uniqueCustomers, 1);
  assert.equal(metrics.adoption.selectedRate, 50);
  assert.equal(metrics.routeBreakdown[0].count, 1);
  assert.equal(metrics.sceneBreakdown.length, 2);
  assert.equal(metrics.reviewResultBreakdown.length, 2);
  assert.equal(metrics.riskLevelBreakdown.length, 2);
  assert.equal(metrics.staleReasonBreakdown[0].staleReason, 'new-analysis-generated');
  assert.equal(metrics.topIssues[0].issueType, 'OVER_PUSH');
  assert.equal(metrics.promptVersionBreakdown.generation.length, 2);
});
