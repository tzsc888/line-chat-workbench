import test from "node:test";
import assert from "node:assert/strict";
import {
  AutomationJobKind,
  AutomationJobStatus,
  MessageRole,
  MessageType,
} from "@prisma/client";
import { decideInboundTriggerPolicy } from "../../lib/inbound/trigger-policy";
import { buildMessagePipelineStatuses } from "../../lib/ai/pipeline-status";
import { planPartialInboundJobReconcile } from "../../lib/inbound/reconcile-plan";

test("bridge live text message pipeline closed-loop visibility", () => {
  const now = new Date("2026-04-20T01:00:00.000Z");

  const trigger = decideInboundTriggerPolicy({
    mode: "live",
    messageType: MessageType.TEXT,
    created: true,
    isFirstInboundText: true,
  });
  assert.equal(trigger.shouldQueueTranslation, true);
  assert.equal(trigger.shouldQueueWorkflow, true);

  const pipeline = buildMessagePipelineStatuses({
    messages: [
      {
        id: "msg-live-1",
        role: MessageRole.CUSTOMER,
        type: MessageType.TEXT,
        chineseText: "已经翻译",
        createdAt: now,
        updatedAt: now,
      },
    ],
    jobs: [
      {
        targetMessageId: "msg-live-1",
        kind: AutomationJobKind.INBOUND_TRANSLATION,
        status: AutomationJobStatus.DONE,
        lastError: null,
        updatedAt: now,
        finishedAt: now,
      },
      {
        targetMessageId: "msg-live-1",
        kind: AutomationJobKind.INBOUND_WORKFLOW,
        status: AutomationJobStatus.DONE,
        lastError: null,
        updatedAt: now,
        finishedAt: now,
      },
    ],
    drafts: [
      {
        id: "draft-1",
        targetCustomerMessageId: "msg-live-1",
        createdAt: now,
        updatedAt: now,
      },
    ],
  }).get("msg-live-1");

  assert.ok(pipeline);
  assert.deepEqual(
    pipeline!.steps.map((step) => [step.step, step.status]),
    [
      ["translation", "succeeded"],
      ["generation", "succeeded"],
    ],
  );
  assert.equal(
    pipeline!.steps.some((step) => step.reason_code === "generation_not_needed"),
    false,
  );
});

test("reconcile only backfills missing translation job", () => {
  const messages = [
    {
      id: "msg-gap-1",
      customerId: "c-1",
      chineseText: null,
    },
  ];

  const firstPlan = planPartialInboundJobReconcile({
    messages,
    jobs: [
      {
        customerId: "c-1",
        targetMessageId: "msg-gap-1",
        kind: AutomationJobKind.INBOUND_TRANSLATION,
      },
    ],
  });

  assert.deepEqual(firstPlan, []);

  const secondPlan = planPartialInboundJobReconcile({
    messages,
    jobs: [
      {
        customerId: "c-1",
        targetMessageId: "msg-gap-1",
        kind: AutomationJobKind.INBOUND_TRANSLATION,
      },
      {
        customerId: "c-1",
        targetMessageId: "msg-gap-1",
        kind: AutomationJobKind.INBOUND_WORKFLOW,
      },
    ],
  });

  assert.deepEqual(secondPlan, []);
});
