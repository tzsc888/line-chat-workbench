import test from "node:test";
import assert from "node:assert/strict";
import { deriveDraftPresentation } from "../../lib/ai/draft-presentation";

test("deriveDraftPresentation marks mismatched target message as stale", () => {
  const result = deriveDraftPresentation(
    {
      id: "d1",
      targetCustomerMessageId: "m1",
      stableJapanese: "A",
      stableChinese: "A zh",
      advancingJapanese: "B",
      advancingChinese: "B zh",
      isStale: false,
      staleReason: null,
      staleAt: null,
      selectedVariant: null,
      selectedAt: null,
      createdAt: new Date().toISOString(),
    },
    "m2",
  );

  assert.equal(result.isStale, true);
  assert.equal(result.primaryActionLabel, "生成回复");
});

test("deriveDraftPresentation no longer blocks by final gate", () => {
  const result = deriveDraftPresentation(
    {
      id: "d2",
      targetCustomerMessageId: "m1",
      stableJapanese: "A",
      stableChinese: "A zh",
      advancingJapanese: "B",
      advancingChinese: "B zh",
      isStale: false,
      staleReason: null,
      staleAt: null,
      selectedVariant: null,
      selectedAt: null,
      createdAt: new Date().toISOString(),
    },
    "m1",
  );

  assert.equal(result.isBlocked, false);
  assert.equal(result.shouldDimDraft, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.primaryActionLabel, "生成回复");
});
