import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDraftPresentation } from '../../lib/ai/draft-presentation.ts';

test('deriveDraftPresentation marks mismatched target message as stale', () => {
  const result = deriveDraftPresentation({
    id: 'd1',
    targetCustomerMessageId: 'm1',
    stableJapanese: 'A',
    stableChinese: '甲',
    advancingJapanese: 'B',
    advancingChinese: '乙',
    sceneType: 'INITIAL_CONTACT',
    routeType: 'LIGHT_HOLD',
    replyGoal: '先接住',
    pushLevel: 'LIGHT_HOLD',
    differenceNote: '',
    generationBriefJson: JSON.stringify({ mission: '先接住' }),
    reviewFlagsJson: JSON.stringify({ confidence: 'MEDIUM', review_reason: '观察' }),
    programChecksJson: JSON.stringify({ passed: true, issues: [] }),
    aiReviewJson: JSON.stringify({ overall_result: 'PASS_WITH_NOTE', human_attention_note: '注意语气' }),
    finalGateJson: JSON.stringify({ can_show_to_human: true, can_recommend_direct_use: true }),
    selfCheckJson: JSON.stringify({ followed_route: true }),
    recommendedVariant: 'STABLE',
    isStale: false,
    staleReason: null,
    staleAt: null,
    selectedVariant: null,
    selectedAt: null,
    createdAt: new Date().toISOString(),
  }, 'm2');

  assert.equal(result.isStale, true);
  assert.match(result.statusNote, /失效|过期/);
  assert.equal(result.primaryActionLabel, '基于最新消息重生');
});

test('deriveDraftPresentation blocks direct use when final gate forbids showing', () => {
  const result = deriveDraftPresentation({
    id: 'd2',
    targetCustomerMessageId: 'm1',
    stableJapanese: 'A',
    stableChinese: '甲',
    advancingJapanese: 'B',
    advancingChinese: '乙',
    sceneType: 'CLEAR_OBJECTION',
    routeType: 'OBJECTION_HANDLING',
    replyGoal: '先处理异议',
    pushLevel: 'NO_PUSH',
    differenceNote: '',
    generationBriefJson: null,
    reviewFlagsJson: JSON.stringify({ confidence: 'LOW' }),
    programChecksJson: JSON.stringify({ passed: false, issues: ['长度过长'] }),
    aiReviewJson: JSON.stringify({ issues_found: [{ explanation: '推进过头' }] }),
    finalGateJson: JSON.stringify({ can_show_to_human: false, can_recommend_direct_use: false }),
    selfCheckJson: null,
    recommendedVariant: null,
    isStale: false,
    staleReason: null,
    staleAt: null,
    selectedVariant: null,
    selectedAt: null,
    createdAt: new Date().toISOString(),
  }, 'm1');

  assert.equal(result.isBlocked, true);
  assert.equal(result.shouldDimDraft, true);
  assert.equal(result.issues.length, 2);
  assert.equal(result.primaryActionLabel, '重新生成可用版本');
});
