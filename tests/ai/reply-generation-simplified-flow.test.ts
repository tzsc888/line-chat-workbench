import test from "node:test";
import assert from "node:assert/strict";
import { __testOnly } from "../../lib/ai/reply-generation-service";
import { normalizeGenerationReply, validateMainBrainGenerationResult } from "../../lib/ai/protocol-validator";

test("operator note empty should not become undefined/null and section should stay", () => {
  const payload = __testOnly.buildPromptPayload({
    rewriteInput: "",
    latestMessage: { id: "m2", role: "CUSTOMER", type: "TEXT", japaneseText: "はい", sentAt: "2026-05-01T11:01:00.000Z" },
    recentMessages: [
      { id: "m1", role: "OPERATOR", type: "TEXT", japaneseText: "ご希望があれば詳しく見ます。", sentAt: "2026-05-01T11:00:00.000Z" },
      { id: "m2", role: "CUSTOMER", type: "TEXT", japaneseText: "はい", sentAt: "2026-05-01T11:01:00.000Z" },
    ],
  });
  assert.match(payload, /【今回だけの補足指示】/);
  assert.doesNotMatch(payload, /undefined|null/);
});

test("current customer messages should keep consecutive bubbles with numbering", () => {
  const payload = __testOnly.buildPromptPayload({
    rewriteInput: "",
    latestMessage: { id: "m5", role: "CUSTOMER", type: "IMAGE", japaneseText: "", sentAt: "2026-05-01T11:05:00.000Z" },
    recentMessages: [
      { id: "m1", role: "OPERATOR", type: "TEXT", japaneseText: "写真があればお願いします。", sentAt: "2026-05-01T11:00:00.000Z" },
      { id: "m2", role: "CUSTOMER", type: "TEXT", japaneseText: "はい", sentAt: "2026-05-01T11:02:00.000Z" },
      { id: "m3", role: "CUSTOMER", type: "TEXT", japaneseText: "写真送ります", sentAt: "2026-05-01T11:03:00.000Z" },
      { id: "m4", role: "OPERATOR", type: "TEXT", japaneseText: "受け取りました。", sentAt: "2026-05-01T11:04:00.000Z" },
      { id: "m5", role: "CUSTOMER", type: "IMAGE", japaneseText: "", sentAt: "2026-05-01T11:05:00.000Z" },
    ],
  });
  assert.match(payload, /1\.\n\[画像が送信されています\]/);
});

test("reply_ja schema normalization should reject legacy-only shape in main path expectation", () => {
  const normalized = normalizeGenerationReply({ reply_a_ja: "A", reply_b_ja: "B" });
  assert.equal(normalized.reply_ja, "");
  const valid = validateMainBrainGenerationResult({ reply_ja: "返信です" });
  assert.equal(valid.reply_ja, "返信です");
});
