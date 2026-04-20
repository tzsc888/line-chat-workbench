import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBridgePlaceholderName,
  isValidIsoTimestamp,
  sanitizeBridgeDisplayName,
} from '../../lib/bridge/identity';

test('bridge identity helpers normalize display names and placeholders', () => {
  assert.equal(sanitizeBridgeDisplayName(' Unknown '), '');
  assert.equal(sanitizeBridgeDisplayName(' 村上美希子 '), '村上美希子');
  assert.equal(buildBridgePlaceholderName('abc123456789'), 'LINE网页会话 23456789');
});

test('bridge timestamp validation only accepts real ISO datetimes', () => {
  assert.equal(isValidIsoTimestamp('2026-04-17T10:20:00.000Z'), true);
  assert.equal(isValidIsoTimestamp(''), false);
  assert.equal(isValidIsoTimestamp('not-a-date'), false);
});
