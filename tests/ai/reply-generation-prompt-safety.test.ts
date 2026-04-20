import test from "node:test";
import assert from "node:assert/strict";
import { replyGenerationPrompt } from "../../lib/ai/prompts/reply-generation";

test("reply generation prompt should include JSON quote-safety guidance", () => {
  assert.match(replyGenerationPrompt.system, /ASCII/);
  assert.match(replyGenerationPrompt.system, /双引号|quote/i);
  assert.match(replyGenerationPrompt.system, /“ ”/);
  assert.match(replyGenerationPrompt.system, /「 」/);
});
