import test from "node:test";
import assert from "node:assert/strict";
import { buildDisplayedWorkspaceMessages } from "../../app/workbench/workspace/hooks/use-workspace-messages";

type BaseMessage = {
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

type OptimisticMessage = BaseMessage & {
  isOptimistic: true;
  replyDraftSetId?: string;
  suggestionVariant?: "STABLE" | "ADVANCING" | null;
};

function base(overrides?: Partial<BaseMessage>): BaseMessage {
  return {
    id: "srv-1",
    customerId: "c-1",
    role: "OPERATOR",
    type: "TEXT",
    source: "MANUAL",
    lineMessageId: null,
    japaneseText: "こんにちは",
    chineseText: "你好",
    imageUrl: null,
    stickerPackageId: null,
    stickerId: null,
    deliveryStatus: "PENDING",
    sendError: null,
    lastAttemptAt: null,
    failedAt: null,
    retryCount: 0,
    sentAt: "2026-04-20T00:00:01.000Z",
    createdAt: "2026-04-20T00:00:01.000Z",
    updatedAt: "2026-04-20T00:00:01.000Z",
    ...overrides,
  };
}

function optimistic(overrides?: Partial<OptimisticMessage>): OptimisticMessage {
  return {
    ...base({
      id: "optimistic:1",
      sentAt: "2026-04-20T00:00:00.500Z",
      createdAt: "2026-04-20T00:00:00.500Z",
      updatedAt: "2026-04-20T00:00:00.500Z",
    }),
    isOptimistic: true,
    ...overrides,
  };
}

test("projection suppresses optimistic duplicate when persisted match arrives later", () => {
  const merged = buildDisplayedWorkspaceMessages(
    [base({ id: "srv-1", sentAt: "2026-04-20T00:00:01.000Z" })],
    [optimistic({ id: "optimistic:1", sentAt: "2026-04-20T00:00:00.500Z" })],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "srv-1");
});

test("projection keeps optimistic message when persisted candidate is older (real second send case)", () => {
  const merged = buildDisplayedWorkspaceMessages(
    [base({ id: "srv-old", sentAt: "2026-04-20T00:00:00.000Z" })],
    [optimistic({ id: "optimistic:new", sentAt: "2026-04-20T00:00:01.000Z" })],
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((m) => m.id), ["srv-old", "optimistic:new"]);
});

test("projection keeps FAILED optimistic message visible even if payload matches", () => {
  const merged = buildDisplayedWorkspaceMessages(
    [base({ id: "srv-1", sentAt: "2026-04-20T00:00:01.000Z" })],
    [optimistic({ id: "optimistic:failed", deliveryStatus: "FAILED", sendError: "failed" })],
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((m) => m.id).sort(), ["optimistic:failed", "srv-1"]);
});
