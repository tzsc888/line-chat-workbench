export const PIPELINE_REASON_CODES = {
  NON_TEXT_MESSAGE: "non_text_message",
  NON_LIVE_MODE: "non_live_mode",
  DUPLICATE_MESSAGE: "duplicate_message",
  ALREADY_TRANSLATED: "already_translated",
  TRANSLATION_NOT_NEEDED: "translation_not_needed",
  GENERATION_NOT_NEEDED: "generation_not_needed",
  AUTO_GENERATION_FIRST_INBOUND_ONLY: "auto_generation_first_inbound_only",
  REUSED_EXISTING_DRAFT: "reused_existing_draft",
  JOB_NOT_RUN_YET: "job_not_run_yet",
  JOB_EXECUTION_ERROR: "job_execution_error",
  MESSAGE_NOT_FOUND: "message_not_found",
} as const;

export type PipelineReasonCode = (typeof PIPELINE_REASON_CODES)[keyof typeof PIPELINE_REASON_CODES];

const PIPELINE_REASON_LABELS: Record<PipelineReasonCode, string> = {
  [PIPELINE_REASON_CODES.NON_TEXT_MESSAGE]: "Non-text message",
  [PIPELINE_REASON_CODES.NON_LIVE_MODE]: "Non-live mode",
  [PIPELINE_REASON_CODES.DUPLICATE_MESSAGE]: "Duplicate inbound message",
  [PIPELINE_REASON_CODES.ALREADY_TRANSLATED]: "Already translated",
  [PIPELINE_REASON_CODES.TRANSLATION_NOT_NEEDED]: "Translation not needed",
  [PIPELINE_REASON_CODES.GENERATION_NOT_NEEDED]: "Generation not needed",
  [PIPELINE_REASON_CODES.AUTO_GENERATION_FIRST_INBOUND_ONLY]: "Auto generation only for first inbound text",
  [PIPELINE_REASON_CODES.REUSED_EXISTING_DRAFT]: "Reused existing draft",
  [PIPELINE_REASON_CODES.JOB_NOT_RUN_YET]: "Job not run yet",
  [PIPELINE_REASON_CODES.JOB_EXECUTION_ERROR]: "Job execution error",
  [PIPELINE_REASON_CODES.MESSAGE_NOT_FOUND]: "Message not found",
};

export function getPipelineReasonLabel(reasonCode: PipelineReasonCode | null, fallback = "") {
  if (!reasonCode) return fallback;
  return PIPELINE_REASON_LABELS[reasonCode] || fallback || reasonCode;
}

export function parsePipelineReasonCode(raw: string | null | undefined): PipelineReasonCode | null {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  const candidates = Object.values(PIPELINE_REASON_CODES) as string[];
  return candidates.includes(value) ? (value as PipelineReasonCode) : null;
}

