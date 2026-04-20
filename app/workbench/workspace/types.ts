export type MessagePipelineStep = {
  step: "translation" | "analysis" | "suggestions";
  status: "pending" | "succeeded" | "skipped" | "failed" | "reused";
  reason_code: string | null;
  reason_label: string;
  updated_at: string;
  source?: string | null;
  retryable?: boolean | null;
};

export type MessagePipeline = {
  message_id: string;
  steps: MessagePipelineStep[];
};

export type WorkspaceRenderableMessage = {
  id: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  japaneseText: string;
  chineseText: string | null;
  imageUrl: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  sentAt: string;
  deliveryStatus: "PENDING" | "SENT" | "FAILED" | null;
  sendError: string | null;
  isOptimistic?: boolean;
  aiPipeline?: MessagePipeline | null;
};
