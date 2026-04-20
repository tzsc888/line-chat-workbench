import test from "node:test";
import assert from "node:assert/strict";
import { deriveDefaultTimingKey, timingKeyToNextFollowupAt } from "../../lib/followup-rules";

test("followup timing defaults use strategy-mapped tier windows", () => {
  const key = deriveDefaultTimingKey({
    followupBucket: "UNCONVERTED",
    followupTier: "B",
  });
  assert.equal(key, "IN_1_DAY");
});

test("TODAY timing uses strategy-configured hour offset", () => {
  const base = new Date("2026-04-20T00:00:00.000Z");
  const next = timingKeyToNextFollowupAt("TODAY", base);
  assert.ok(next instanceof Date);
  assert.equal(next!.toISOString(), "2026-04-20T02:00:00.000Z");
});
