import { useMemo } from "react";

type WorkspaceMessageLike = {
  id: string;
  customerId: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION";
  lineMessageId: string | null;
  japaneseText: string;
  chineseText: string | null;
  imageUrl: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  deliveryStatus: "PENDING" | "SENT" | "FAILED" | null;
  sendError: string | null;
  lastAttemptAt: string | null;
  failedAt: string | null;
  retryCount: number;
  sentAt: string;
  createdAt: string;
  updatedAt: string;
  aiPipeline?: unknown;
};

type OptimisticWorkspaceMessageLike = WorkspaceMessageLike & {
  isOptimistic: true;
  replyDraftSetId?: string;
  suggestionVariant?: "STABLE" | "ADVANCING" | null;
};

type WorkspaceLike = {
  customer: {
    id: string;
  };
  messages: WorkspaceMessageLike[];
};

function toMs(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isSameRenderablePayload(
  optimistic: OptimisticWorkspaceMessageLike,
  persisted: WorkspaceMessageLike,
) {
  return (
    optimistic.customerId === persisted.customerId &&
    optimistic.role === "OPERATOR" &&
    persisted.role === "OPERATOR" &&
    optimistic.type === persisted.type &&
    optimistic.source === persisted.source &&
    (optimistic.japaneseText || "") === (persisted.japaneseText || "") &&
    (optimistic.chineseText || "") === (persisted.chineseText || "") &&
    (optimistic.imageUrl || "") === (persisted.imageUrl || "") &&
    (optimistic.stickerPackageId || "") === (persisted.stickerPackageId || "") &&
    (optimistic.stickerId || "") === (persisted.stickerId || "")
  );
}

function shouldSuppressOptimistic(
  optimistic: OptimisticWorkspaceMessageLike,
  baseMessages: WorkspaceMessageLike[],
) {
  if (optimistic.deliveryStatus === "FAILED") return false;

  const optimisticTime = toMs(optimistic.sentAt);
  return baseMessages.some((persisted) => {
    if (!isSameRenderablePayload(optimistic, persisted)) return false;
    const persistedTime = toMs(persisted.sentAt);
    // Realtime may bring the persisted message slightly earlier than local reconciliation.
    // Suppress only when persisted message is not earlier than optimistic timestamp.
    if (persistedTime < optimisticTime) return false;
    return persistedTime - optimisticTime <= 30_000;
  });
}

export function buildDisplayedWorkspaceMessages(
  baseMessages: WorkspaceMessageLike[],
  optimisticMessages: OptimisticWorkspaceMessageLike[],
) {
  const filteredOptimistic = optimisticMessages.filter((item) => !shouldSuppressOptimistic(item, baseMessages));
  const merged = [...baseMessages, ...filteredOptimistic];
  merged.sort((a, b) => {
    const aTime = new Date(a.sentAt).getTime();
    const bTime = new Date(b.sentAt).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });
  return merged;
}

export function useWorkspaceMessages<TWorkspace extends WorkspaceLike>(input: {
  workspace: TWorkspace | null;
  optimisticMessagesByCustomer: Record<string, OptimisticWorkspaceMessageLike[]>;
}) {
  const displayedWorkspaceMessages = useMemo(() => {
    if (!input.workspace) return [] as Array<WorkspaceMessageLike | OptimisticWorkspaceMessageLike>;
    return buildDisplayedWorkspaceMessages(
      input.workspace.messages,
      input.optimisticMessagesByCustomer[input.workspace.customer.id] || [],
    );
  }, [input.optimisticMessagesByCustomer, input.workspace]);

  return {
    state: {
      displayedWorkspaceMessages,
    },
  };
}
