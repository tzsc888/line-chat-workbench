import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAnalysisFollowupState, mergeUniqueTags, mergeUniqueText, timingBucketToDate } from '../../lib/ai/state-merge-helpers.ts';

test('mergeUniqueText deduplicates and keeps stable order', () => {
  const result = mergeUniqueText('A\nB', ['B', 'C', '']);
  assert.equal(result, 'A\nB\nC');
});

test('mergeUniqueTags deduplicates risk tags', () => {
  assert.deepEqual(mergeUniqueTags(['价格敏感', '慢热'], ['慢热', '高防备']), ['价格敏感', '慢热', '高防备']);
});

test('mapAnalysisFollowupState preserves richer states', () => {
  assert.equal(mapAnalysisFollowupState('OBSERVING'), 'OBSERVING');
  assert.equal(mapAnalysisFollowupState('WAITING_WINDOW'), 'WAITING_WINDOW');
  assert.equal(mapAnalysisFollowupState('POST_PURCHASE_CARE'), 'POST_PURCHASE_CARE');
});

test('timingBucketToDate returns null for NO_SET', () => {
  assert.equal(timingBucketToDate('NO_SET'), null);
});
