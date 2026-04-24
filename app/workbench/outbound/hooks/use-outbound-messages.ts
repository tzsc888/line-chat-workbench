import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { MessageSource } from "@prisma/client";

const OPTIMISTIC_ID_PREFIX = "optimistic:";

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
};

type OptimisticWorkspaceMessageLike = WorkspaceMessageLike & {
  isOptimistic: true;
  replyDraftSetId?: string;
  suggestionVariant?: "STABLE" | "ADVANCING" | null;
};

type WorkspaceLike = {
  customer: {
    id: string;
    lastMessageAt: string | null;
  };
  messages: WorkspaceMessageLike[];
};

export type SubmitOutboundMessageInput = {
  customerId: string;
  japaneseText: string;
  chineseText?: string | null;
  imageUrl?: string | null;
  stickerPackageId?: string | null;
  stickerId?: string | null;
  type: "TEXT" | "IMAGE" | "STICKER";
  source: MessageSource;
  replyDraftSetId?: string;
  suggestionVariant?: "STABLE" | "ADVANCING";
  optimisticMessageId?: string;
};

function normalizeWorkspaceMessagePayload(payload: unknown): WorkspaceMessageLike | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as Record<string, unknown>;
  if (typeof data.id !== "string") return null;
  if (typeof data.customerId !== "string") return null;
  if (data.role !== "CUSTOMER" && data.role !== "OPERATOR") return null;
  if (data.type !== "TEXT" && data.type !== "IMAGE" && data.type !== "STICKER") return null;
  if (data.source !== "LINE" && data.source !== "MANUAL" && data.source !== "AI_SUGGESTION") return null;
  if (typeof data.sentAt !== "string") return null;

  return {
    id: data.id,
    customerId: data.customerId,
    role: data.role,
    type: data.type,
    source: data.source,
    lineMessageId: typeof data.lineMessageId === "string" ? data.lineMessageId : null,
    japaneseText: typeof data.japaneseText === "string" ? data.japaneseText : "",
    chineseText: typeof data.chineseText === "string" ? data.chineseText : null,
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : null,
    stickerPackageId: typeof data.stickerPackageId === "string" ? data.stickerPackageId : null,
    stickerId: typeof data.stickerId === "string" ? data.stickerId : null,
    deliveryStatus:
      data.deliveryStatus === "PENDING" || data.deliveryStatus === "SENT" || data.deliveryStatus === "FAILED"
        ? data.deliveryStatus
        : null,
    sendError: typeof data.sendError === "string" ? data.sendError : null,
    lastAttemptAt: typeof data.lastAttemptAt === "string" ? data.lastAttemptAt : null,
    failedAt: typeof data.failedAt === "string" ? data.failedAt : null,
    retryCount: Number(data.retryCount ?? 0),
    sentAt: data.sentAt,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : data.sentAt,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : data.sentAt,
  };
}

type SubmitExecutorInput = {
  params: SubmitOutboundMessageInput;
  makeOptimisticId: () => string;
  nowIso: () => string;
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onAddOptimisticMessage: (customerId: string, message: OptimisticWorkspaceMessageLike) => void;
  onUpdateOptimisticMessage: (
    customerId: string,
    messageId: string,
    updater: (message: OptimisticWorkspaceMessageLike) => OptimisticWorkspaceMessageLike,
  ) => void;
  onRemoveOptimisticMessage: (customerId: string, messageId: string) => void;
  onUpsertWorkspaceMessage: (customerId: string, message: WorkspaceMessageLike) => void;
  onUpdateCustomerLatestMessage: (customerId: string, message: WorkspaceMessageLike | OptimisticWorkspaceMessageLike) => void;
  onAttachAsyncTranslation: (messageId: string, japaneseText: string) => void;
};

export async function executeSubmitOutboundMessage(input: SubmitExecutorInput) {
  const { params } = input;
  const sentAt = input.nowIso();
  const optimisticId = params.optimisticMessageId || input.makeOptimisticId();
  const baseOptimisticMessage: OptimisticWorkspaceMessageLike = {
    id: optimisticId,
    customerId: params.customerId,
    role: "OPERATOR",
    type: params.type,
    source: params.source,
    lineMessageId: null,
    japaneseText: params.japaneseText,
    chineseText: params.chineseText ?? null,
    imageUrl: params.type === "IMAGE" ? params.imageUrl ?? null : null,
    stickerPackageId: params.type === "STICKER" ? params.stickerPackageId ?? null : null,
    stickerId: params.type === "STICKER" ? params.stickerId ?? null : null,
    deliveryStatus: "PENDING",
    sendError: null,
    lastAttemptAt: sentAt,
    failedAt: null,
    retryCount: 0,
    sentAt,
    createdAt: sentAt,
    updatedAt: sentAt,
    isOptimistic: true,
    replyDraftSetId: params.replyDraftSetId,
    suggestionVariant: params.suggestionVariant ?? null,
  };

  if (params.optimisticMessageId) {
    input.onUpdateOptimisticMessage(params.customerId, params.optimisticMessageId, () => baseOptimisticMessage);
  } else {
    input.onAddOptimisticMessage(params.customerId, baseOptimisticMessage);
  }
  input.onUpdateCustomerLatestMessage(params.customerId, baseOptimisticMessage);

  try {
    const response = await input.request(`/api/customers/${params.customerId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        japaneseText: params.japaneseText,
        chineseText: params.chineseText ?? "",
        imageUrl: params.imageUrl || "",
        stickerPackageId: params.stickerPackageId || "",
        stickerId: params.stickerId || "",
        source: params.source,
        type: params.type,
        replyDraftSetId: params.replyDraftSetId || "",
        suggestionVariant: params.suggestionVariant || "",
      }),
    });
    const data = await response.json();
    const serverMessage = normalizeWorkspaceMessagePayload((data as { message?: unknown } | null)?.message);

    if (!response.ok || !(data as { ok?: boolean } | null)?.ok) {
      if (serverMessage) {
        input.onUpsertWorkspaceMessage(params.customerId, serverMessage);
        input.onUpdateCustomerLatestMessage(params.customerId, serverMessage);
        input.onRemoveOptimisticMessage(params.customerId, optimisticId);
      } else {
        const errorMessage = ((data as { error?: string } | null)?.error) || "消息发送失败";
        input.onUpdateOptimisticMessage(params.customerId, optimisticId, (message) => ({
          ...message,
          deliveryStatus: "FAILED",
          sendError: errorMessage,
          failedAt: input.nowIso(),
          lastAttemptAt: input.nowIso(),
        }));
      }
      return { ok: false };
    }

    if (serverMessage) {
      input.onUpsertWorkspaceMessage(params.customerId, serverMessage);
      input.onUpdateCustomerLatestMessage(params.customerId, serverMessage);
      input.onRemoveOptimisticMessage(params.customerId, optimisticId);
      const hasProvidedChinese = typeof params.chineseText === "string" && !!params.chineseText.trim();
      if (params.type === "TEXT" && !hasProvidedChinese) {
        input.onAttachAsyncTranslation(serverMessage.id, params.japaneseText);
      }
    }

    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    input.onUpdateOptimisticMessage(params.customerId, optimisticId, (message) => ({
      ...message,
      deliveryStatus: "FAILED",
      sendError: errorMessage,
      failedAt: input.nowIso(),
      lastAttemptAt: input.nowIso(),
    }));
    return { ok: false };
  }
}

type RetryExecutorInput = {
  messageId: string;
  workspaceCustomerId: string | null;
  retryContextCustomerId?: string | null;
  retryingMessageId: string;
  optimisticMessagesByCustomer: Record<string, OptimisticWorkspaceMessageLike[]>;
  setRetryingMessageId: (messageId: string) => void;
  submitOutboundMessage: (params: SubmitOutboundMessageInput) => Promise<{ ok: boolean }>;
  updateWorkspaceMessage: (
    customerId: string,
    messageId: string,
    updater: (message: WorkspaceMessageLike) => WorkspaceMessageLike,
  ) => void;
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  nowIso: () => string;
  loadWorkspace: (customerId: string, options?: { preserveUi?: boolean }) => Promise<void>;
  loadCustomers: (options?: { preserveUi?: boolean }) => Promise<void>;
};

export async function executeRetryMessage(input: RetryExecutorInput) {
  const retryTargetCustomerId = input.retryContextCustomerId || input.workspaceCustomerId;
  if (!retryTargetCustomerId || input.retryingMessageId === input.messageId) return;

  input.setRetryingMessageId(input.messageId);
  try {
    if (input.messageId.startsWith(OPTIMISTIC_ID_PREFIX)) {
      const optimisticMessage =
        (input.optimisticMessagesByCustomer[retryTargetCustomerId] || []).find((item) => item.id === input.messageId) ||
        Object.values(input.optimisticMessagesByCustomer).flat().find((item) => item.id === input.messageId);
      if (!optimisticMessage) return;
      await input.submitOutboundMessage({
        customerId: optimisticMessage.customerId,
        japaneseText: optimisticMessage.japaneseText,
        chineseText: optimisticMessage.chineseText,
        imageUrl: optimisticMessage.imageUrl,
        stickerPackageId: optimisticMessage.stickerPackageId,
        stickerId: optimisticMessage.stickerId,
        source: optimisticMessage.source,
        type: optimisticMessage.type,
        replyDraftSetId: optimisticMessage.replyDraftSetId,
        suggestionVariant: optimisticMessage.suggestionVariant ?? undefined,
        optimisticMessageId: optimisticMessage.id,
      });
      return;
    }

    input.updateWorkspaceMessage(retryTargetCustomerId, input.messageId, (message) => ({
      ...message,
      deliveryStatus: "PENDING",
      sendError: null,
      failedAt: null,
      lastAttemptAt: input.nowIso(),
    }));
    const response = await input.request(`/api/messages/${input.messageId}/retry`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok || !(data as { ok?: boolean } | null)?.ok) {
      input.updateWorkspaceMessage(retryTargetCustomerId, input.messageId, (message) => ({
        ...message,
        deliveryStatus: "FAILED",
        sendError: (data as { error?: string } | null)?.error || "消息重试失败",
        failedAt: input.nowIso(),
        lastAttemptAt: input.nowIso(),
      }));
      return;
    }
    await input.loadWorkspace(retryTargetCustomerId, { preserveUi: true });
    await input.loadCustomers({ preserveUi: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.updateWorkspaceMessage(retryTargetCustomerId, input.messageId, (item) => ({
      ...item,
      deliveryStatus: "FAILED",
      sendError: message,
      failedAt: input.nowIso(),
      lastAttemptAt: input.nowIso(),
    }));
  } finally {
    input.setRetryingMessageId("");
  }
}

export function useOutboundMessages<TWorkspace extends WorkspaceLike>(input: {
  workspaceCustomerId: string | null;
  setWorkspace: Dispatch<SetStateAction<TWorkspace | null>>;
  updateCustomerLatestMessage: (customerId: string, message: WorkspaceMessageLike | OptimisticWorkspaceMessageLike) => void;
  loadWorkspace: (customerId: string, options?: { preserveUi?: boolean }) => Promise<void>;
  loadCustomers: (options?: { preserveUi?: boolean }) => Promise<void>;
}) {
  const [optimisticMessagesByCustomer, setOptimisticMessagesByCustomer] = useState<Record<string, OptimisticWorkspaceMessageLike[]>>({});
  const [retryingMessageId, setRetryingMessageId] = useState("");

  const addOptimisticMessage = useCallback((customerId: string, message: OptimisticWorkspaceMessageLike) => {
    setOptimisticMessagesByCustomer((prev) => {
      const nextList = [...(prev[customerId] || []).filter((item) => item.id !== message.id), message];
      return {
        ...prev,
        [customerId]: nextList,
      };
    });
  }, []);

  const updateOptimisticMessage = useCallback(
    (customerId: string, messageId: string, updater: (message: OptimisticWorkspaceMessageLike) => OptimisticWorkspaceMessageLike) => {
      setOptimisticMessagesByCustomer((prev) => {
        const currentList = prev[customerId] || [];
        const nextList = currentList.map((item) => (item.id === messageId ? updater(item) : item));
        return {
          ...prev,
          [customerId]: nextList,
        };
      });
    },
    [],
  );

  const removeOptimisticMessage = useCallback((customerId: string, messageId: string) => {
    setOptimisticMessagesByCustomer((prev) => {
      const currentList = prev[customerId] || [];
      const nextList = currentList.filter((item) => item.id !== messageId);
      if (!nextList.length) {
        const nextState = { ...prev };
        delete nextState[customerId];
        return nextState;
      }
      return {
        ...prev,
        [customerId]: nextList,
      };
    });
  }, []);

  const upsertWorkspaceMessage = useCallback((customerId: string, message: WorkspaceMessageLike) => {
    input.setWorkspace((prev) => {
      if (!prev || prev.customer.id !== customerId) return prev;
      const nextMessages = [...prev.messages.filter((item) => item.id !== message.id), message].sort((a, b) => {
        const aTime = new Date(a.sentAt).getTime();
        const bTime = new Date(b.sentAt).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return a.id.localeCompare(b.id);
      });
      return {
        ...prev,
        customer: {
          ...prev.customer,
          lastMessageAt: message.sentAt,
        },
        messages: nextMessages,
      };
    });
  }, [input]);

  const updateWorkspaceMessage = useCallback(
    (customerId: string, messageId: string, updater: (message: WorkspaceMessageLike) => WorkspaceMessageLike) => {
      input.setWorkspace((prev) => {
        if (!prev || prev.customer.id !== customerId) return prev;
        return {
          ...prev,
          messages: prev.messages.map((item) => (item.id === messageId ? updater(item) : item)),
        };
      });
    },
    [input],
  );

  const attachAsyncTranslation = useCallback(async (messageId: string, japaneseText: string) => {
    if (!messageId || !japaneseText.trim()) return;
    try {
      const translateResponse = await fetch("/api/translate-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          japanese: japaneseText,
        }),
      });
      const translateData = await translateResponse.json();
      if (!translateResponse.ok || !translateData.ok || !translateData.chinese) {
        return;
      }
      await fetch(`/api/messages/${messageId}/translation`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chineseText: translateData.chinese,
        }),
      });
    } catch (error) {
      console.error("translate patch error:", error);
    }
  }, []);

  const submitOutboundMessage = useCallback(
    async (params: SubmitOutboundMessageInput) => {
      return executeSubmitOutboundMessage({
        params,
        makeOptimisticId: () => `${OPTIMISTIC_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nowIso: () => new Date().toISOString(),
        request: fetch,
        onAddOptimisticMessage: addOptimisticMessage,
        onUpdateOptimisticMessage: updateOptimisticMessage,
        onRemoveOptimisticMessage: removeOptimisticMessage,
        onUpsertWorkspaceMessage: upsertWorkspaceMessage,
        onUpdateCustomerLatestMessage: input.updateCustomerLatestMessage,
        onAttachAsyncTranslation: (messageId, japaneseText) => {
          void attachAsyncTranslation(messageId, japaneseText);
        },
      });
    },
    [
      addOptimisticMessage,
      attachAsyncTranslation,
      input,
      removeOptimisticMessage,
      updateOptimisticMessage,
      upsertWorkspaceMessage,
    ],
  );

  const retryMessage = useCallback(
    async (messageId: string, retryContextCustomerId?: string | null) => {
      return executeRetryMessage({
        messageId,
        workspaceCustomerId: input.workspaceCustomerId,
        retryContextCustomerId,
        retryingMessageId,
        optimisticMessagesByCustomer,
        setRetryingMessageId,
        submitOutboundMessage,
        updateWorkspaceMessage,
        request: fetch,
        nowIso: () => new Date().toISOString(),
        loadWorkspace: input.loadWorkspace,
        loadCustomers: input.loadCustomers,
      });
    },
    [
      input,
      optimisticMessagesByCustomer,
      retryingMessageId,
      submitOutboundMessage,
      updateWorkspaceMessage,
    ],
  );

  return {
    state: {
      optimisticMessagesByCustomer,
      retryingMessageId,
    },
    actions: {
      submitOutboundMessage,
      retryMessage,
    },
  };
}
