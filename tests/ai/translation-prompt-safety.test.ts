import test from "node:test";
import assert from "node:assert/strict";
import { translationPrompt } from "../../lib/ai/prompts/translation";
import { __testOnly as translationTest } from "../../lib/ai/translation-service";

test("translation prompt should contain review constraints", () => {
  const s = translationPrompt.system;
  assert.match(s, /保留 ①②③/);
  assert.match(s, /不要把 さん 翻成“酱”/);
  assert.match(s, /鑑定 译为“鉴定”/);
  assert.match(s, /視る 译为“看\/查看”/);
});

test("translation postprocess should preserve bubbles and avoid 酱/调查/占断", () => {
  const out = translationTest.normalizeChineseReviewTone("① もも酱\n② 視るは调查\n③ 占断と鑑定");
  assert.match(out, /①/);
  assert.match(out, /\n\n②/);
  assert.match(out, /\n\n③/);
  assert.equal(out.includes("酱"), false);
  assert.equal(out.includes("调查"), false);
  assert.equal(out.includes("占断"), false);
  assert.match(out, /鉴定/);
});
