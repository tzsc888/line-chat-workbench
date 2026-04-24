import test from "node:test";
import assert from "node:assert/strict";
import {
  executeRetryMessage,
  executeSubmitOutboundMessage,
  type SubmitOutboundMessageInput,
} from "../../app/workbench/outbound/hooks/use-outbound-messages";

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

function createHarness() {
  let optimisticMessagesByCustomer: Record<string, OptimisticWorkspaceMessageLike[]> = {};
  let workspaceMessages: WorkspaceMessageLike[] = [];
  let retryingMessageId = "";
  const latestMessages: Array<WorkspaceMessageLike | OptimisticWorkspaceMessageLike> = [];

  return {
    get optimistic() {
      return optimisticMessagesByCustomer;
    },
    get workspaceMessages() {
      return workspaceMessages;
    },
    get retrying() {
      return retryingMessageId;
    },
    get latestMessages() {
      return latestMessages;
    },
    addOptimistic(customerId: string, message: OptimisticWorkspaceMessageLike) {
      const current = optimisticMessagesByCustomer[customerId] || [];
      optimisticMessagesByCustomer = {
        ...optimisticMessagesByCustomer,
        [customerId]: [...current.filter((item) => item.id !== message.id), message],
      };
    },
    updateOptimistic(
      customerId: string,
      messageId: string,
      updater: (message: OptimisticWorkspaceMessageLike) => OptimisticWorkspaceMessageLike,
    ) {
      const current = optimisticMessagesByCustomer[customerId] || [];
      optimisticMessagesByCustomer = {
        ...optimisticMessagesByCustomer,
        [customerId]: current.map((item) => (item.id === messageId ? updater(item) : item)),
      };
    },
    removeOptimistic(customerId: string, messageId: string) {
      const current = optimisticMessagesByCustomer[customerId] || [];
      const next = current.filter((item) => item.id !== messageId);
      if (next.length) {
        optimisticMessagesByCustomer = {
          ...optimisticMessagesByCustomer,
          [customerId]: next,
        };
        return;
      }
      const copy = { ...optimisticMessagesByCustomer };
      delete copy[customerId];
      optimisticMessagesByCustomer = copy;
    },
    upsertWorkspaceMessage(_customerId: string, message: WorkspaceMessageLike) {
      workspaceMessages = [...workspaceMessages.filter((item) => item.id !== message.id), message];
    },
    updateWorkspaceMessage(_customerId: string, messageId: string, updater: (message: WorkspaceMessageLike) => WorkspaceMessageLike) {
      workspaceMessages = workspaceMessages.map((item) => (item.id === messageId ? updater(item) : item));
    },
    setRetrying(messageId: string) {
      retryingMessageId = messageId;
    },
    pushLatest(_customerId: string, message: WorkspaceMessageLike | OptimisticWorkspaceMessageLike) {
      latestMessages.push(message);
    },
  };
}

function mockResponse(body: unknown, ok = true) {
  return {
    ok,
    async json() {
      return body;
    },
  } as Response;
}

function buildSubmitParams(overrides?: Partial<SubmitOutboundMessageInput>): SubmitOutboundMessageInput {
  return {
    customerId: "c-1",
    japaneseText: "hello-ja",
    chineseText: "hello-zh",
    type: "TEXT",
    source: "MANUAL",
    ...overrides,
  };
}

function buildServerMessage(overrides?: Partial<WorkspaceMessageLike>) {
  return {
    id: "srv-1",
    customerId: "c-1",
    role: "OPERATOR" as const,
    type: "TEXT" as const,
    source: "MANUAL" as const,
    lineMessageId: null,
    japaneseText: "hello-ja",
    chineseText: "hello-zh",
    imageUrl: null,
    stickerPackageId: null,
    stickerId: null,
    deliveryStatus: "PENDING" as const,
    sendError: null,
    lastAttemptAt: "2026-04-20T00:00:00.000Z",
    failedAt: null,
    retryCount: 0,
    sentAt: "2026-04-20T00:00:00.000Z",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

test("submit manual text success should reconcile optimistic and upsert server message", async () => {
  const store = createHarness();
  const translations: Array<{ id: string; text: string }> = [];

  const result = await executeSubmitOutboundMessage({
    params: buildSubmitParams({ chineseText: null }),
    makeOptimisticId: () => "optimistic:1",
    nowIso: () => "2026-04-20T00:00:00.000Z",
    request: async () => mockResponse({ ok: true, message: buildServerMessage() }, true),
    onAddOptimisticMessage: store.addOptimistic.bind(store),
    onUpdateOptimisticMessage: store.updateOptimistic.bind(store),
    onRemoveOptimisticMessage: store.removeOptimistic.bind(store),
    onUpsertWorkspaceMessage: store.upsertWorkspaceMessage.bind(store),
    onUpdateCustomerLatestMessage: store.pushLatest.bind(store),
    onAttachAsyncTranslation: (id, text) => {
      translations.push({ id, text });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(store.optimistic, {});
  assert.equal(store.workspaceMessages.length, 1);
  assert.equal(store.workspaceMessages[0].id, "srv-1");
  assert.equal(store.latestMessages.at(-1)?.id, "srv-1");
  assert.deepEqual(translations, [{ id: "srv-1", text: "hello-ja" }]);
});

test("submit text with existing chinese should skip async translation attach", async () => {
  const store = createHarness();
  let translationCalled = false;

  await executeSubmitOutboundMessage({
    params: buildSubmitParams({ chineseText: "existing-zh" }),
    makeOptimisticId: () => "optimistic:zh1",
    nowIso: () => "2026-04-20T00:00:00.000Z",
    request: async () => mockResponse({ ok: true, message: buildServerMessage({ id: "srv-zh-1" }) }, true),
    onAddOptimisticMessage: store.addOptimistic.bind(store),
    onUpdateOptimisticMessage: store.updateOptimistic.bind(store),
    onRemoveOptimisticMessage: store.removeOptimistic.bind(store),
    onUpsertWorkspaceMessage: store.upsertWorkspaceMessage.bind(store),
    onUpdateCustomerLatestMessage: store.pushLatest.bind(store),
    onAttachAsyncTranslation: () => {
      translationCalled = true;
    },
  });

  assert.equal(translationCalled, false);
});

test("submit image path should go through unified submit entry and skip translation attach", async () => {
  const store = createHarness();
  const capture: { body?: Record<string, unknown> } = {};
  let translationCalled = false;

  await executeSubmitOutboundMessage({
    params: buildSubmitParams({
      japaneseText: "",
      chineseText: null,
      type: "IMAGE",
      imageUrl: "https://img.example/1.jpg",
      source: "MANUAL",
    }),
    makeOptimisticId: () => "optimistic:img1",
    nowIso: () => "2026-04-20T00:00:00.000Z",
    request: async (_url, init) => {
      capture.body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return mockResponse({
        ok: true,
        message: buildServerMessage({
          id: "srv-img-1",
          type: "IMAGE",
          imageUrl: "https://img.example/1.jpg",
          japaneseText: "",
          chineseText: null,
        }),
      }, true);
    },
    onAddOptimisticMessage: store.addOptimistic.bind(store),
    onUpdateOptimisticMessage: store.updateOptimistic.bind(store),
    onRemoveOptimisticMessage: store.removeOptimistic.bind(store),
    onUpsertWorkspaceMessage: store.upsertWorkspaceMessage.bind(store),
    onUpdateCustomerLatestMessage: store.pushLatest.bind(store),
    onAttachAsyncTranslation: () => {
      translationCalled = true;
    },
  });

  assert.equal(capture.body?.type, "IMAGE");
  assert.equal(capture.body?.imageUrl, "https://img.example/1.jpg");
  assert.equal(translationCalled, false);
});

test("submit AI suggestion should still use unified submit entry with AI source payload", async () => {
  const store = createHarness();
  const capture: { body?: Record<string, unknown> } = {};

  await executeSubmitOutboundMessage({
    params: buildSubmitParams({
      source: "AI_SUGGESTION",
      suggestionVariant: "STABLE",
      replyDraftSetId: "draft-1",
    }),
    makeOptimisticId: () => "optimistic:ai1",
    nowIso: () => "2026-04-20T00:00:00.000Z",
    request: async (_url, init) => {
      capture.body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return mockResponse({ ok: true, message: buildServerMessage({ id: "srv-ai-1", source: "AI_SUGGESTION" }) }, true);
    },
    onAddOptimisticMessage: store.addOptimistic.bind(store),
    onUpdateOptimisticMessage: store.updateOptimistic.bind(store),
    onRemoveOptimisticMessage: store.removeOptimistic.bind(store),
    onUpsertWorkspaceMessage: store.upsertWorkspaceMessage.bind(store),
    onUpdateCustomerLatestMessage: store.pushLatest.bind(store),
    onAttachAsyncTranslation: () => {},
  });

  assert.equal(capture.body?.source, "AI_SUGGESTION");
  assert.equal(capture.body?.replyDraftSetId, "draft-1");
  assert.equal(capture.body?.suggestionVariant, "STABLE");
});

test("retry optimistic failed message should reuse submit with optimisticMessageId", async () => {
  const store = createHarness();
  store.addOptimistic("c-1", {
    id: "optimistic:retry1",
    customerId: "c-1",
    role: "OPERATOR",
    type: "TEXT",
    source: "MANUAL",
    lineMessageId: null,
    japaneseText: "retry-text",
    chineseText: null,
    imageUrl: null,
    stickerPackageId: null,
    stickerId: null,
    deliveryStatus: "FAILED",
    sendError: "failed",
    lastAttemptAt: null,
    failedAt: null,
    retryCount: 1,
    sentAt: "2026-04-20T00:00:00.000Z",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    isOptimistic: true,
  });

  const submitCapture: { value?: SubmitOutboundMessageInput } = {};
  await executeRetryMessage({
    messageId: "optimistic:retry1",
    workspaceCustomerId: "c-1",
    retryingMessageId: "",
    optimisticMessagesByCustomer: store.optimistic,
    setRetryingMessageId: store.setRetrying.bind(store),
    submitOutboundMessage: async (params) => {
      submitCapture.value = params;
      return { ok: true };
    },
    updateWorkspaceMessage: store.updateWorkspaceMessage.bind(store),
    request: async () => {
      throw new Error("should not call persisted retry endpoint");
    },
    nowIso: () => "2026-04-20T00:00:00.000Z",
    loadWorkspace: async () => {},
    loadCustomers: async () => {},
  });

  const submitParams = submitCapture.value;
  assert.equal(submitParams?.optimisticMessageId, "optimistic:retry1");
  assert.equal(submitParams?.japaneseText, "retry-text");
  assert.equal(store.retrying, "");
});

test("retry persisted failed message should call /api/messages/:id/retry and keep status consistent", async () => {
  const store = createHarness();
  store.upsertWorkspaceMessage("c-1", buildServerMessage({
    id: "srv-failed-1",
    deliveryStatus: "FAILED",
    sendError: "old error",
  }));

  let calledUrl = "";
  let loadWorkspaceCalled = false;
  let loadCustomersCalled = false;

  await executeRetryMessage({
    messageId: "srv-failed-1",
    workspaceCustomerId: "c-1",
    retryingMessageId: "",
    optimisticMessagesByCustomer: store.optimistic,
    setRetryingMessageId: store.setRetrying.bind(store),
    submitOutboundMessage: async () => ({ ok: true }),
    updateWorkspaceMessage: store.updateWorkspaceMessage.bind(store),
    request: async (url) => {
      calledUrl = String(url);
      return mockResponse({ ok: true }, true);
    },
    nowIso: () => "2026-04-20T00:00:00.000Z",
    loadWorkspace: async () => {
      loadWorkspaceCalled = true;
    },
    loadCustomers: async () => {
      loadCustomersCalled = true;
    },
  });

  assert.equal(calledUrl, "/api/messages/srv-failed-1/retry");
  assert.equal(store.workspaceMessages[0].deliveryStatus, "PENDING");
  assert.equal(loadWorkspaceCalled, true);
  assert.equal(loadCustomersCalled, true);
  assert.equal(store.retrying, "");
});

test("retry optimistic should still work when active workspace changed but retry context points to original customer", async () => {
  const store = createHarness();
  store.addOptimistic("c-a", {
    id: "optimistic:cross-a1",
    customerId: "c-a",
    role: "OPERATOR",
    type: "TEXT",
    source: "MANUAL",
    lineMessageId: null,
    japaneseText: "A failed message",
    chineseText: null,
    imageUrl: null,
    stickerPackageId: null,
    stickerId: null,
    deliveryStatus: "FAILED",
    sendError: "failed",
    lastAttemptAt: null,
    failedAt: null,
    retryCount: 1,
    sentAt: "2026-04-20T00:00:00.000Z",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    isOptimistic: true,
  });

  let submittedForCustomerId = "";
  await executeRetryMessage({
    messageId: "optimistic:cross-a1",
    workspaceCustomerId: "c-b",
    retryContextCustomerId: "c-a",
    retryingMessageId: "",
    optimisticMessagesByCustomer: store.optimistic,
    setRetryingMessageId: store.setRetrying.bind(store),
    submitOutboundMessage: async (params) => {
      submittedForCustomerId = params.customerId;
      return { ok: true };
    },
    updateWorkspaceMessage: store.updateWorkspaceMessage.bind(store),
    request: async () => {
      throw new Error("should not call persisted retry endpoint");
    },
    nowIso: () => "2026-04-20T00:00:00.000Z",
    loadWorkspace: async () => {},
    loadCustomers: async () => {},
  });

  assert.equal(submittedForCustomerId, "c-a");
  assert.equal(store.retrying, "");
});

test("retry persisted should use retry context customer id for local update and refresh", async () => {
  const store = createHarness();
  store.upsertWorkspaceMessage("c-a", buildServerMessage({
    id: "srv-a-failed",
    customerId: "c-a",
    deliveryStatus: "FAILED",
    sendError: "old error",
  }));

  let refreshedWorkspaceFor = "";
  await executeRetryMessage({
    messageId: "srv-a-failed",
    workspaceCustomerId: "c-b",
    retryContextCustomerId: "c-a",
    retryingMessageId: "",
    optimisticMessagesByCustomer: store.optimistic,
    setRetryingMessageId: store.setRetrying.bind(store),
    submitOutboundMessage: async () => ({ ok: true }),
    updateWorkspaceMessage: store.updateWorkspaceMessage.bind(store),
    request: async () => mockResponse({ ok: true }, true),
    nowIso: () => "2026-04-20T00:00:00.000Z",
    loadWorkspace: async (customerId) => {
      refreshedWorkspaceFor = customerId;
    },
    loadCustomers: async () => {},
  });

  assert.equal(refreshedWorkspaceFor, "c-a");
  assert.equal(store.workspaceMessages[0].deliveryStatus, "PENDING");
  assert.equal(store.retrying, "");
});

test("reconciliation should upsert by id without duplicate messages", async () => {
  const store = createHarness();
  store.upsertWorkspaceMessage("c-1", buildServerMessage({ id: "srv-dup-1", japaneseText: "old" }));

  await executeSubmitOutboundMessage({
    params: buildSubmitParams({ japaneseText: "new", chineseText: null }),
    makeOptimisticId: () => "optimistic:dup1",
    nowIso: () => "2026-04-20T00:00:00.000Z",
    request: async () => mockResponse({
      ok: true,
      message: buildServerMessage({
        id: "srv-dup-1",
        japaneseText: "new",
      }),
    }, true),
    onAddOptimisticMessage: store.addOptimistic.bind(store),
    onUpdateOptimisticMessage: store.updateOptimistic.bind(store),
    onRemoveOptimisticMessage: store.removeOptimistic.bind(store),
    onUpsertWorkspaceMessage: store.upsertWorkspaceMessage.bind(store),
    onUpdateCustomerLatestMessage: store.pushLatest.bind(store),
    onAttachAsyncTranslation: () => {},
  });

  assert.equal(store.workspaceMessages.length, 1);
  assert.equal(store.workspaceMessages[0].id, "srv-dup-1");
  assert.equal(store.workspaceMessages[0].japaneseText, "new");
  assert.deepEqual(store.optimistic, {});
});
