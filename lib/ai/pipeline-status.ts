import { AutomationJobKind, AutomationJobStatus, MessageRole, MessageType } from "@prisma/client";
import {
  PIPELINE_REASON_CODES,
  getPipelineReasonLabel,
  parsePipelineReasonCode,
  type PipelineReasonCode,
} from "@/lib/ai/pipeline-reason";

export type PipelineStepKey = "translation" | "generation";
export type PipelineStepStatus = "pending" | "succeeded" | "skipped" | "failed" | "reused";

export type MessagePipelineStep = {
  step: PipelineStepKey;
  status: PipelineStepStatus;
  reason_code: PipelineReasonCode | null;
  reason_label: string;
  updated_at: string;
};

export type MessagePipelineStatus = {
  message_id: string;
  steps: MessagePipelineStep[];
};

type PipelineMessage = {
  id: string;
  role: MessageRole;
  type: MessageType;
  chineseText: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type PipelineJob = {
  targetMessageId: string;
  kind: AutomationJobKind;
  status: AutomationJobStatus;
  lastError: string | null;
  updatedAt: Date;
  finishedAt: Date | null;
};

type PipelineDraft = {
  id: string;
  targetCustomerMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function iso(date: Date | null | undefined) {
  const value = date instanceof Date ? date : new Date();
  return value.toISOString();
}

function buildJobIndex(jobs: PipelineJob[]) {
  const index = new Map<string, Map<AutomationJobKind, PipelineJob>>();
  for (const job of jobs) {
    const byKind = index.get(job.targetMessageId) || new Map<AutomationJobKind, PipelineJob>();
    const current = byKind.get(job.kind);
    if (!current || current.updatedAt < job.updatedAt) {
      byKind.set(job.kind, job);
    }
    index.set(job.targetMessageId, byKind);
  }
  return index;
}

function buildDraftIndex(drafts: PipelineDraft[]) {
  const index = new Map<string, PipelineDraft>();
  for (const draft of drafts) {
    const targetId = String(draft.targetCustomerMessageId || "").trim();
    if (!targetId) continue;
    const current = index.get(targetId);
    if (!current || current.createdAt < draft.createdAt) {
      index.set(targetId, draft);
    }
  }
  return index;
}

function getJobReasonCode(job: PipelineJob | null): PipelineReasonCode | null {
  if (!job?.lastError) return null;
  const parsed = parsePipelineReasonCode(job.lastError);
  if (parsed) return parsed;
  if (job.status === AutomationJobStatus.FAILED) {
    return PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR;
  }
  return null;
}

function buildStep(
  step: PipelineStepKey,
  status: PipelineStepStatus,
  reasonCode: PipelineReasonCode | null,
  updatedAt: Date,
  fallbackLabel = "",
) {
  return {
    step,
    status,
    reason_code: reasonCode,
    reason_label: getPipelineReasonLabel(reasonCode, fallbackLabel),
    updated_at: iso(updatedAt),
  } satisfies MessagePipelineStep;
}

function buildNonTextPipeline(message: PipelineMessage) {
  return {
    message_id: message.id,
    steps: [
      buildStep("translation", "skipped", PIPELINE_REASON_CODES.NON_TEXT_MESSAGE, message.updatedAt),
      buildStep("generation", "skipped", PIPELINE_REASON_CODES.NON_TEXT_MESSAGE, message.updatedAt),
    ],
  } satisfies MessagePipelineStatus;
}

function buildTextPipeline(input: {
  message: PipelineMessage;
  translationJob: PipelineJob | null;
  workflowJob: PipelineJob | null;
  draft: PipelineDraft | null;
}) {
  const { message, translationJob, workflowJob, draft } = input;
  const translationReasonCode = getJobReasonCode(translationJob);
  const workflowReasonCode = getJobReasonCode(workflowJob);

  let translationStep: MessagePipelineStep;
  if (message.chineseText?.trim()) {
    translationStep = buildStep(
      "translation",
      "succeeded",
      PIPELINE_REASON_CODES.ALREADY_TRANSLATED,
      translationJob?.updatedAt || message.updatedAt,
    );
  } else if (!translationJob) {
    translationStep = buildStep("translation", "pending", PIPELINE_REASON_CODES.JOB_NOT_RUN_YET, message.updatedAt);
  } else if (translationJob.status === AutomationJobStatus.PENDING || translationJob.status === AutomationJobStatus.RUNNING) {
    translationStep = buildStep("translation", "pending", PIPELINE_REASON_CODES.JOB_NOT_RUN_YET, translationJob.updatedAt);
  } else if (translationJob.status === AutomationJobStatus.FAILED) {
    translationStep = buildStep("translation", "failed", PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR, translationJob.updatedAt, translationJob.lastError || "");
  } else if (translationJob.status === AutomationJobStatus.SKIPPED) {
    translationStep = buildStep(
      "translation",
      "skipped",
      translationReasonCode || PIPELINE_REASON_CODES.TRANSLATION_NOT_NEEDED,
      translationJob.updatedAt,
      translationJob.lastError || "",
    );
  } else {
    translationStep = buildStep("translation", "succeeded", null, translationJob.updatedAt);
  }

  let generationStep: MessagePipelineStep;
  if (!workflowJob) {
    generationStep = buildStep("generation", "pending", PIPELINE_REASON_CODES.JOB_NOT_RUN_YET, message.updatedAt);
  } else if (workflowJob.status === AutomationJobStatus.PENDING || workflowJob.status === AutomationJobStatus.RUNNING) {
    generationStep = buildStep("generation", "pending", PIPELINE_REASON_CODES.JOB_NOT_RUN_YET, workflowJob.updatedAt);
  } else if (workflowJob.status === AutomationJobStatus.FAILED) {
    generationStep = buildStep("generation", "failed", PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR, workflowJob.updatedAt, workflowJob.lastError || "");
  } else if (workflowJob.status === AutomationJobStatus.SKIPPED) {
    if (workflowReasonCode === PIPELINE_REASON_CODES.REUSED_EXISTING_DRAFT) {
      generationStep = buildStep("generation", "reused", workflowReasonCode, workflowJob.updatedAt);
    } else {
      generationStep = buildStep(
        "generation",
        "skipped",
        workflowReasonCode || PIPELINE_REASON_CODES.GENERATION_NOT_NEEDED,
        workflowJob.updatedAt,
        workflowJob.lastError || "",
      );
    }
  } else if (draft) {
    generationStep = buildStep("generation", "succeeded", null, draft.updatedAt);
  } else {
    generationStep = buildStep("generation", "succeeded", null, workflowJob.updatedAt);
  }

  return {
    message_id: message.id,
    steps: [translationStep, generationStep],
  } satisfies MessagePipelineStatus;
}

export function buildMessagePipelineStatuses(input: {
  messages: PipelineMessage[];
  jobs: PipelineJob[];
  drafts: PipelineDraft[];
}) {
  const jobIndex = buildJobIndex(input.jobs);
  const draftIndex = buildDraftIndex(input.drafts);
  const pipelines = new Map<string, MessagePipelineStatus>();

  for (const message of input.messages) {
    if (message.role !== MessageRole.CUSTOMER) continue;
    if (message.type !== MessageType.TEXT) {
      pipelines.set(message.id, buildNonTextPipeline(message));
      continue;
    }

    const byKind = jobIndex.get(message.id) || new Map<AutomationJobKind, PipelineJob>();
    const translationJob = byKind.get(AutomationJobKind.INBOUND_TRANSLATION) || null;
    const workflowJob = byKind.get(AutomationJobKind.INBOUND_WORKFLOW) || null;
    const draft = draftIndex.get(message.id) || null;

    pipelines.set(
      message.id,
      buildTextPipeline({
        message,
        translationJob,
        workflowJob,
        draft,
      }),
    );
  }

  return pipelines;
}

