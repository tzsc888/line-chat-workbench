import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeGenerationReply, validateMainBrainGenerationResult } from "../../lib/ai/protocol-validator";

test("main schema accepts reply_ja string", () => {
  const parsed = validateMainBrainGenerationResult({ reply_ja: "返信です" });
  assert.equal(parsed.reply_ja, "返信です");
});

test("legacy A/B-only shape is not accepted as main reply_ja", () => {
  const parsed = normalizeGenerationReply({ reply_a_ja: "A", reply_b_ja: "B" });
  assert.equal(parsed.reply_ja, "");
});

test("empty or non-string reply_ja normalizes to empty", () => {
  assert.equal(normalizeGenerationReply({ reply_ja: "" }).reply_ja, "");
  assert.equal(normalizeGenerationReply({ reply_ja: 123 }).reply_ja, "");
});

test("generation service contract should require reply_ja and disallow additional properties", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "lib/ai/reply-generation-service.ts"), "utf8");
  assert.match(source, /required:\s*\["reply_ja"\]/);
  assert.match(source, /additionalProperties:\s*false/);
});

