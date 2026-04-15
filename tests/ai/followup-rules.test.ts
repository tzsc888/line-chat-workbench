import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveEffectiveBucket, resolveFollowupView } from '../../lib/followup-rules.ts';

test('VIP markers force VIP bucket', () => {
  assert.equal(deriveEffectiveBucket({ isVip: true }), 'VIP');
  assert.equal(deriveEffectiveBucket({ remarkName: 'vip客户' }), 'VIP');
});

test('resolveFollowupView preserves richer followup states', () => {
  const view = resolveFollowupView({
    followupState: 'WAITING_WINDOW',
    followupBucket: 'UNCONVERTED',
    followupTier: 'B',
    nextFollowupBucket: 'IN_3_DAYS',
  });
  assert.equal(view.state, 'WAITING_WINDOW');
});
