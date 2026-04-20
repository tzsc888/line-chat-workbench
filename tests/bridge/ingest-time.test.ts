import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIngestEventTime } from '../../lib/services/ingest-time';

test('strict bridge ingest refuses missing sentAt', () => {
  assert.throws(() => resolveIngestEventTime({ strictSentAt: true }), /缺少有效 sentAt/);
  assert.throws(() => resolveIngestEventTime({ sentAt: 'bad-value', strictSentAt: true }), /缺少有效 sentAt/);
});

test('non-strict ingest still allows legacy fallback', () => {
  const resolved = resolveIngestEventTime({});
  assert.equal(resolved instanceof Date, true);
  assert.equal(Number.isNaN(resolved.getTime()), false);
});
