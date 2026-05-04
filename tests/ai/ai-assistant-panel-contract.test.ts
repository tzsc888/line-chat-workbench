import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("ai assistant panel should wire single Chinese suggestion field to card", () => {
  const source = read("app/components/ai-assistant-panel.tsx");
  assert.match(source, /chinese=\{props\.displayedSuggestion1Zh\}/);
  assert.doesNotMatch(source, /displayedSuggestion2Zh/);
});

test("ai assistant panel should keep single-card send and hide A/B labels", () => {
  const source = read("app/components/ai-assistant-panel.tsx");
  assert.match(source, /title="AI 回复建议"/);
  assert.doesNotMatch(source, /A 稳妥版/);
  assert.doesNotMatch(source, /B 推进版/);
  assert.match(source, /onSend=\{props\.onSendReply\}/);
});

test("ai assistant panel should keep rewrite input field", () => {
  const source = read("app/components/ai-assistant-panel.tsx");
  assert.match(source, /rewriteInput/);
  assert.match(source, /onRewriteInputChange/);
});

test("pipeline mini should not expose review label in new flow", () => {
  const source = read("app/workbench/workspace/components/message-ai-pipeline-mini.tsx");
  assert.doesNotMatch(source, /review\s*:/);
  assert.doesNotMatch(source, /复核/);
});
