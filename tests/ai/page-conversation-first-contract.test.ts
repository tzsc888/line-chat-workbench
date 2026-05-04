import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("page should send rewriteInput in generate api request", () => {
  const source = read("app/page.tsx");
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*customerId,\s*rewriteInput,\s*\}\)/s);
});

test("page should wire single reply send path to AiAssistantPanel", () => {
  const source = read("app/page.tsx");
  assert.match(source, /onSendReply=\{\(\) => addAiReplyToChat\(displayedSuggestion1Ja, displayedSuggestion1Zh, "stable"\)\}/);
  assert.doesNotMatch(source, /onSendStable=/);
  assert.doesNotMatch(source, /onSendAdvancing=/);
});

