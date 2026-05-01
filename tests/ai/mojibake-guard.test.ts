import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { collectTargetFiles, scanMojibake, checkRequiredTokens } from "../../scripts/check-utf8-mojibake.mjs";

test("mojibake scanner should pass in target directories", () => {
  const files = collectTargetFiles();
  const hits = scanMojibake(files);
  assert.equal(hits.length, 0, JSON.stringify(hits, null, 2));
});

test("reply-generation prompt should have required readable tokens", () => {
  const missing = checkRequiredTokens();
  assert.equal(missing.length, 0, JSON.stringify(missing, null, 2));
  const file = path.resolve(process.cwd(), "lib/ai/prompts/reply-generation.ts");
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes("\uFFFD"), false);
});
