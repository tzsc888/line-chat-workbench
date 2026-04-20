import test from "node:test";
import assert from "node:assert/strict";
import { AutomationJobKind, AutomationJobStatus, MessageRole, MessageType } from "@prisma/client";
import { PIPELINE_REASON_CODES } from "../../lib/ai/pipeline-reason";
import { buildMessagePipelineStatuses } from "../../lib/ai/pipeline-status";

const now = new Date("2026-04-20T00:00:00.000Z");

test("pipeline status marks reused_existing_draft as reused (not succeeded)", () => {
  const map = buildMessagePipelineStatuses({
    messages: [
      {
        id: "m1",
        role: MessageRole.CUSTOMER,
        type: MessageType.TEXT,
        chineseText: "你好",
        createdAt: now,
        updatedAt: now,
      },
    ],
    jobs: [
      {
        targetMessageId: "m1",
        kind: AutomationJobKind.INBOUND_WORKFLOW,
        status: AutomationJobStatus.SKIPPED,
        lastError: PIPELINE_REASON_CODES.REUSED_EXISTING_DRAFT,
        updatedAt: now,
        finishedAt: now,
      },
    ],
    drafts: [],
  });

  const pipeline = map.get("m1");
  assert.ok(pipeline);
  const suggestions = pipeline!.steps.find((step) => step.step === "suggestions");
  assert.ok(suggestions);
  assert.equal(suggestions!.status, "reused");
  assert.equal(suggestions!.reason_code, PIPELINE_REASON_CODES.REUSED_EXISTING_DRAFT);
  assert.equal(pipeline!.steps.some((step) => String(step.step) === "review"), false);
});

test("pipeline status returns clear non_text_message reason for non-text customer message", () => {
  const map = buildMessagePipelineStatuses({
    messages: [
      {
        id: "m2",
        role: MessageRole.CUSTOMER,
        type: MessageType.IMAGE,
        chineseText: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    jobs: [],
    drafts: [],
  });

  const pipeline = map.get("m2");
  assert.ok(pipeline);
  for (const step of pipeline!.steps) {
    assert.equal(step.status, "skipped");
    assert.equal(step.reason_code, PIPELINE_REASON_CODES.NON_TEXT_MESSAGE);
  }
  assert.equal(pipeline!.steps.some((step) => String(step.step) === "review"), false);
});
