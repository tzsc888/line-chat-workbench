import { MessageType } from "@prisma/client";
import { PIPELINE_REASON_CODES, type PipelineReasonCode } from "@/lib/ai/pipeline-reason";

export type InboundTriggerDecision = {
  shouldQueueTranslation: boolean;
  shouldQueueWorkflow: boolean;
  translationReasonCode: PipelineReasonCode | null;
  workflowReasonCode: PipelineReasonCode | null;
};

export function decideInboundTriggerPolicy(input: {
  mode: "live" | "non_live";
  messageType: MessageType;
  created: boolean;
  isFirstInboundText?: boolean;
}) {
  if (!input.created) {
    return {
      shouldQueueTranslation: false,
      shouldQueueWorkflow: false,
      translationReasonCode: PIPELINE_REASON_CODES.DUPLICATE_MESSAGE,
      workflowReasonCode: PIPELINE_REASON_CODES.DUPLICATE_MESSAGE,
    } satisfies InboundTriggerDecision;
  }

  if (input.messageType !== MessageType.TEXT) {
    return {
      shouldQueueTranslation: false,
      shouldQueueWorkflow: false,
      translationReasonCode: PIPELINE_REASON_CODES.NON_TEXT_MESSAGE,
      workflowReasonCode: PIPELINE_REASON_CODES.NON_TEXT_MESSAGE,
    } satisfies InboundTriggerDecision;
  }

  if (input.mode !== "live") {
    return {
      shouldQueueTranslation: false,
      shouldQueueWorkflow: false,
      translationReasonCode: PIPELINE_REASON_CODES.NON_LIVE_MODE,
      workflowReasonCode: PIPELINE_REASON_CODES.NON_LIVE_MODE,
    } satisfies InboundTriggerDecision;
  }

  const isFirstInboundText = input.isFirstInboundText === true;

  return {
    shouldQueueTranslation: true,
    shouldQueueWorkflow: isFirstInboundText,
    translationReasonCode: null,
    workflowReasonCode: isFirstInboundText ? null : PIPELINE_REASON_CODES.AUTO_GENERATION_FIRST_INBOUND_ONLY,
  } satisfies InboundTriggerDecision;
}

