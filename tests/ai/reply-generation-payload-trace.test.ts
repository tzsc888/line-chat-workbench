import test from "node:test";
import assert from "node:assert/strict";
import { __testOnly } from "../../lib/ai/reply-generation-service";

function buildSamplePayload(rewriteInput = "補足メモ") {
  return __testOnly.buildPromptPayload({
    taskId: "task-1",
    customerId: "customer-1",
    targetMessageId: "m-target",
    latestMessage: {
      id: "m-latest",
      role: "CUSTOMER",
      type: "TEXT",
      japaneseText: "どうやって詳しく見ていただけますか？",
      sentAt: "2026-05-01T10:03:00.000Z",
    },
    recentMessages: [
      {
        id: "m-op",
        role: "OPERATOR",
        type: "TEXT",
        japaneseText: "気になる点があれば教えてください。",
        sentAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "m-c1",
        role: "CUSTOMER",
        type: "TEXT",
        japaneseText: "はい",
        sentAt: "2026-05-01T10:01:00.000Z",
      },
      {
        id: "m-c2",
        role: "CUSTOMER",
        type: "IMAGE",
        japaneseText: "",
        sentAt: "2026-05-01T10:02:00.000Z",
      },
      {
        id: "m-latest",
        role: "CUSTOMER",
        type: "TEXT",
        japaneseText: "どうやって詳しく見ていただけますか？",
        sentAt: "2026-05-01T10:03:00.000Z",
      },
    ],
    rewriteInput,
  });
}

test("payload trace should not output when AI_PAYLOAD_TRACE is not enabled", () => {
  const logs: string[] = [];
  const writes: Array<{ p: string; c: string; e: BufferEncoding }> = [];
  const emitted = __testOnly.maybeTracePayload({
    context: { taskId: "task-1", customerId: "customer-1" },
    system: "sys",
    userPayload: buildSamplePayload(),
    env: { AI_PAYLOAD_TRACE: "0" },
    log: (text) => logs.push(text),
    writeFile: (p, c, e) => writes.push({ p, c, e }),
    ensureDir: () => {},
    resolveCwd: () => "/tmp",
  });
  assert.equal(emitted, false);
  assert.equal(logs.length, 0);
  assert.equal(writes.length, 0);
});

test("payload trace should output full report when AI_PAYLOAD_TRACE=1", () => {
  const logs: string[] = [];
  const writes: Array<{ p: string; c: string; e: BufferEncoding }> = [];
  const system = "あなたは与えられた指示に従って JSON のみを返すAIです。";
  const userPayload = buildSamplePayload("本件は柔らかめにお願いします");

  const emitted = __testOnly.maybeTracePayload({
    context: { taskId: "task-1", customerId: "customer-1", targetMessageId: "m-target", latestMessage: { id: "m-latest" } },
    system,
    userPayload,
    env: { AI_PAYLOAD_TRACE: "1" },
    log: (text) => logs.push(text),
    writeFile: (p, c, e) => writes.push({ p, c, e }),
    ensureDir: () => {},
    resolveCwd: () => "/tmp",
  });

  assert.equal(emitted, true);
  assert.equal(logs.length, 1);
  assert.equal(writes.length, 1);

  const report = logs[0];
  assert.match(report, /taskId: task-1/);
  assert.match(report, /customerId: customer-1/);
  assert.match(report, /targetMessageId: m-target/);
  assert.match(report, /latestMessageId: m-latest/);
  assert.match(report, /system:/);
  assert.match(report, /userPayload:/);

  assert.match(report, /## 1\. システム上の役割・業務背景/);
  assert.match(report, /## 8\. 出力ルール/);
  assert.match(report, /【今回だけの補足指示】/);
  assert.match(report, /本件は柔らかめにお願いします/);

  assert.match(report, /currentTimeReplaced: true/);
  assert.match(report, /chatHistoryBlock:/);
  assert.match(report, /lastOperatorMessageBlock:/);
  assert.match(report, /currentCustomerMessagesBlock:/);
  assert.match(report, /operatorNoteBlock:/);

  assert.match(report, /hasLegacyJsonFields: false/);
  assert.doesNotMatch(report, /"stage":|"simple_context":|"selected_option":|"pain_anchors":|"bridge_meaning":|"post_free_option_reply_focus":/);
});
