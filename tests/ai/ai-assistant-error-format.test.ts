import test from "node:test";
import assert from "node:assert/strict";
import { formatGenerateRepliesError } from "../../app/workbench/ai-assistant/hooks/use-ai-assistant";

test("formatGenerateRepliesError should map generation_missing_chinese_meaning clearly", () => {
  const message = formatGenerateRepliesError(new Error("generation_missing_chinese_meaning"));
  assert.match(message, /Chinese explanation is missing/i);
});

test("formatGenerateRepliesError should preserve explicit generation_empty_reply for fallback UI", () => {
  const message = formatGenerateRepliesError(new Error("generation_empty_reply"));
  assert.match(message, /empty suggestions/i);
});

test("formatGenerateRepliesError should normalize generic error prefix", () => {
  const message = formatGenerateRepliesError("Error: network failed");
  assert.equal(message, "network failed");
});

test("formatGenerateRepliesError should include structured output metadata", () => {
  const message = formatGenerateRepliesError({
    error: "AI structured output invalid",
    errorCode: "MODEL_SCHEMA_INVALID",
    stage: "generation",
    mode: "json_object",
  });
  assert.match(message, /MODEL_SCHEMA_INVALID/);
  assert.match(message, /generation/);
  assert.match(message, /json_object/);
});

test("formatGenerateRepliesError should map malformed JSON structured error clearly", () => {
  const message = formatGenerateRepliesError({
    error: "AI structured output invalid",
    errorCode: "MODEL_JSON_PARSE_ERROR",
    stage: "generation",
    mode: "fallback_extract",
  });
  assert.match(message, /malformed JSON/i);
});
