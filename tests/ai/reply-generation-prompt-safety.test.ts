import test from "node:test";
import assert from "node:assert/strict";
import { replyGenerationPrompt } from "../../lib/ai/prompts/reply-generation";

test("reply generation prompt should enforce JSON-only output lock", () => {
  assert.match(replyGenerationPrompt.system, /JSON/);
  assert.match(replyGenerationPrompt.system, /JSONのみ|JSON only/i);
  assert.match(replyGenerationPrompt.system, /禁止事項/);
});
