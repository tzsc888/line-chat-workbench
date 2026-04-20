import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("ai assistant panel should wire both Chinese suggestion fields to cards", () => {
  const source = read("app/components/ai-assistant-panel.tsx");
  assert.match(source, /chinese=\{props\.displayedSuggestion1Zh\}/);
  assert.match(source, /chinese=\{props\.displayedSuggestion2Zh\}/);
});

test("pipeline mini should not expose review label in new flow", () => {
  const source = read("app/workbench/workspace/components/message-ai-pipeline-mini.tsx");
  assert.doesNotMatch(source, /review\s*:/);
  assert.doesNotMatch(source, /复核/);
});
