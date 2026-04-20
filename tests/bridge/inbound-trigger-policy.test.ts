import test from "node:test";
import assert from "node:assert/strict";
import { MessageType } from "@prisma/client";
import { PIPELINE_REASON_CODES } from "../../lib/ai/pipeline-reason";
import { decideInboundTriggerPolicy } from "../../lib/inbound/trigger-policy";

test("live first inbound text should queue translation and workflow", () => {
  const decision = decideInboundTriggerPolicy({
    mode: "live",
    messageType: MessageType.TEXT,
    created: true,
    isFirstInboundText: true,
  });

  assert.equal(decision.shouldQueueTranslation, true);
  assert.equal(decision.shouldQueueWorkflow, true);
  assert.equal(decision.translationReasonCode, null);
  assert.equal(decision.workflowReasonCode, null);
});

test("live non-first inbound text should queue translation only", () => {
  const decision = decideInboundTriggerPolicy({
    mode: "live",
    messageType: MessageType.TEXT,
    created: true,
    isFirstInboundText: false,
  });

  assert.equal(decision.shouldQueueTranslation, true);
  assert.equal(decision.shouldQueueWorkflow, false);
  assert.equal(decision.workflowReasonCode, PIPELINE_REASON_CODES.AUTO_GENERATION_FIRST_INBOUND_ONLY);
});

test("non-live text message should skip with non_live_mode reason", () => {
  const decision = decideInboundTriggerPolicy({
    mode: "non_live",
    messageType: MessageType.TEXT,
    created: true,
  });

  assert.equal(decision.shouldQueueTranslation, false);
  assert.equal(decision.shouldQueueWorkflow, false);
  assert.equal(decision.translationReasonCode, PIPELINE_REASON_CODES.NON_LIVE_MODE);
  assert.equal(decision.workflowReasonCode, PIPELINE_REASON_CODES.NON_LIVE_MODE);
});

test("duplicate message should skip with duplicate_message reason", () => {
  const decision = decideInboundTriggerPolicy({
    mode: "live",
    messageType: MessageType.TEXT,
    created: false,
  });

  assert.equal(decision.shouldQueueTranslation, false);
  assert.equal(decision.shouldQueueWorkflow, false);
  assert.equal(decision.translationReasonCode, PIPELINE_REASON_CODES.DUPLICATE_MESSAGE);
  assert.equal(decision.workflowReasonCode, PIPELINE_REASON_CODES.DUPLICATE_MESSAGE);
});
