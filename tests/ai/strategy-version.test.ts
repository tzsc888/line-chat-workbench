import test from "node:test";
import assert from "node:assert/strict";
import { AI_BUSINESS_STRATEGY } from "../../lib/ai/strategy/ai-business-strategy";
import { getActiveAiStrategyVersion } from "../../lib/ai/strategy";

test("active strategy version is defined and matches business entry", () => {
  assert.equal(getActiveAiStrategyVersion(), AI_BUSINESS_STRATEGY.version);
  assert.ok(getActiveAiStrategyVersion().startsWith("s2-"));
});
