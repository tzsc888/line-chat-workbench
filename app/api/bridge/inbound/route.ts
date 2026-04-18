import { NextRequest, NextResponse } from "next/server";
import { LineRelationshipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { queueInboundAutomation, queueInboundTranslation } from "@/lib/inbound-automation";
import { ingestCustomerMessage } from "@/lib/services/ingest-customer-message";
import {
  buildBridgePlaceholderName,
  cleanBridgeText,
  isValidIsoTimestamp,
  normalizeBridgeThreadId,
  sanitizeBridgeDisplayName,
} from "@/lib/bridge/identity";

type BridgePreviewCard = {
  url?: string;
  title?: string;
  desc?: string;
  imageUrl?: string;
};

type BridgeMessage = {
  kind: "system" | "chat";
  dayLabel?: string;
  sentAtIso?: string;
  messageId?: string;
  side: "system" | "inbound" | "outbound";
  header?: string;
  text?: string;
  time?: string;
  imageUrls?: string[];
  stickerPackageId?: string;
  stickerId?: string;
  previewCards?: BridgePreviewCard[];
  fingerprint?: string;
};

type BridgePayload = {
  mode: string;
  threadId: string;
  contact: {
    name?: string;
    avatarUrl?: string;
    preview?: string;
    time?: string;
    isUnknownName?: boolean;
  };
  threadStatus: {
    title?: string;
    canSend?: boolean;
    unreachable?: boolean;
    footerText?: string;
    isCancelledLike?: boolean;
  };
  messages: BridgeMessage[];
};

type UpsertBridgeCustomerResult = {
  customer: {
    id: string;
    lineUserId: string | null;
    bridgeThreadId: string | null;
    originalName: string;
    remarkName: string | null;
    avatarUrl: string | null;
    lineRelationshipStatus: LineRelationshipStatus;
  };
  created: boolean;
  profileChanged: boolean;
  relationshipChanged: boolean;
};

function parseBridgeAuth(req: NextRequest) {
  const header = req.headers.get("x-bridge-secret") || "";
  const expected = process.env.BRIDGE_SHARED_SECRET || "";
  return !!expected && header === expected;
}

function buildImportedMessageUniqueId(threadId: string, message: BridgeMessage) {
  if (message.messageId?.trim()) {
    return `web:${threadId}:${message.messageId.trim()}`;
  }
  if (message.fingerprint?.trim()) {
    return `web:${threadId}:fp:${message.fingerprint.trim()}`;
  }

  const fallback = [
    message.kind || "",
    message.side || "",
    message.dayLabel || "",
    message.sentAtIso || "",
    message.time || "",
    message.header || "",
    cleanBridgeText(message.text || ""),
    ...(message.imageUrls || []),
    cleanBridgeText(message.stickerPackageId || ""),
    cleanBridgeText(message.stickerId || ""),
  ].join("||");

  return `web:${threadId}:raw:${Buffer.from(fallback).toString("base64url")}`;
}

function buildImportedMessageFingerprint(threadId: string, message: BridgeMessage) {
  const basis = message.fingerprint?.trim() || buildImportedMessageUniqueId(threadId, message);
  return `bridge:${threadId}:${basis}`;
}

function normalizeBridgeMessage(message: BridgeMessage) {
  return {
    ...message,
    text: cleanBridgeText(message.text || ""),
    imageUrls: Array.isArray(message.imageUrls)
      ? message.imageUrls.filter((item) => typeof item === "string" && item.trim())
      : [],
    stickerPackageId: cleanBridgeText(message.stickerPackageId || ""),
    stickerId: cleanBridgeText(message.stickerId || ""),
    previewCards: Array.isArray(message.previewCards) ? message.previewCards : [],
    sentAtIso: cleanBridgeText(message.sentAtIso || ""),
  };
}

function validateInboundBridgeMessages(messages: ReturnType<typeof normalizeBridgeMessage>[]) {
  for (const msg of messages) {
    if (msg.kind !== "chat" || msg.side !== "inbound") continue;
    if (!isValidIsoTimestamp(msg.sentAtIso)) {
      throw new Error(
        `bridge message sentAtIso 无效，拒绝回退猜时间：${JSON.stringify({
          messageId: msg.messageId || "",
          fingerprint: msg.fingerprint || "",
          sentAtIso: msg.sentAtIso || "",
          textPreview: (msg.text || "").slice(0, 60),
        })}`
      );
    }
  }
}

async function upsertBridgeCustomer(params: {
  threadId: string;
  incomingName: string;
  avatarUrl: string;
  relationshipStatus: LineRelationshipStatus;
}): Promise<UpsertBridgeCustomerResult> {
  const safeIncomingName = sanitizeBridgeDisplayName(params.incomingName);
  const safeAvatarUrl = cleanBridgeText(params.avatarUrl);
  const now = new Date();

  const existing = await prisma.customer.findUnique({
    where: { bridgeThreadId: params.threadId },
    select: {
      id: true,
      lineUserId: true,
      bridgeThreadId: true,
      originalName: true,
      remarkName: true,
      avatarUrl: true,
      lineRelationshipStatus: true,
    },
  });

  if (!existing) {
    const created = await prisma.customer.create({
      data: {
        bridgeThreadId: params.threadId,
        lineUserId: params.threadId,
        originalName: safeIncomingName || buildBridgePlaceholderName(params.threadId),
        remarkName: safeIncomingName || buildBridgePlaceholderName(params.threadId),
        avatarUrl: safeAvatarUrl || null,
        lineRelationshipStatus: params.relationshipStatus,
        lineRelationshipUpdatedAt: now,
        lineRefollowedAt:
          params.relationshipStatus === LineRelationshipStatus.ACTIVE ? now : null,
      },
      select: {
        id: true,
        lineUserId: true,
        bridgeThreadId: true,
        originalName: true,
        remarkName: true,
        avatarUrl: true,
        lineRelationshipStatus: true,
      },
    });

    return {
      customer: created,
      created: true,
      profileChanged: true,
      relationshipChanged: true,
    };
  }

  const relationshipChanged = existing.lineRelationshipStatus !== params.relationshipStatus;
  const profileChanged =
    (!!safeIncomingName && safeIncomingName !== existing.originalName) ||
    (!!safeAvatarUrl && safeAvatarUrl !== (existing.avatarUrl || ""));

  const updated = await prisma.customer.update({
    where: { id: existing.id },
    data: {
      lineUserId: params.threadId,
      originalName: safeIncomingName || undefined,
      avatarUrl: safeAvatarUrl || undefined,
      lineRelationshipStatus: params.relationshipStatus,
      lineRelationshipUpdatedAt: relationshipChanged ? now : undefined,
      lineRefollowedAt:
        params.relationshipStatus === LineRelationshipStatus.UNFOLLOWED
          ? null
          : relationshipChanged && existing.lineRelationshipStatus === LineRelationshipStatus.UNFOLLOWED
            ? now
            : undefined,
    },
    select: {
      id: true,
      lineUserId: true,
      bridgeThreadId: true,
      originalName: true,
      remarkName: true,
      avatarUrl: true,
      lineRelationshipStatus: true,
    },
  });

  return {
    customer: updated,
    created: false,
    profileChanged,
    relationshipChanged,
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!parseBridgeAuth(req)) {
      return NextResponse.json({ ok: false, error: "bridge auth failed" }, { status: 401 });
    }

    const body = (await req.json()) as BridgePayload;
    const threadId = normalizeBridgeThreadId(body.threadId);
    if (!threadId) {
      return NextResponse.json({ ok: false, error: "缺少 threadId" }, { status: 400 });
    }

    const mode = cleanBridgeText(body.mode || "live") || "live";
    const incomingName = sanitizeBridgeDisplayName(body.contact?.name || "");
    const avatarUrl = cleanBridgeText(body.contact?.avatarUrl || "");
    const relationshipStatus =
      body.threadStatus?.isCancelledLike === true
        ? LineRelationshipStatus.UNFOLLOWED
        : LineRelationshipStatus.ACTIVE;

    const customerUpsert = await upsertBridgeCustomer({
      threadId,
      incomingName,
      avatarUrl,
      relationshipStatus,
    });
    const customer = customerUpsert.customer;

    const normalizedMessages = (Array.isArray(body.messages) ? body.messages : [])
      .map(normalizeBridgeMessage)
      .filter((msg) => msg.kind === "chat" && msg.side === "inbound")
      .sort((a, b) => new Date(a.sentAtIso).getTime() - new Date(b.sentAtIso).getTime());

    validateInboundBridgeMessages(normalizedMessages);

    let importedCount = 0;
    let latestLiveTextMessageId = "";
    const translationQueuedMessageIds: string[] = [];

    for (const msg of normalizedMessages) {
      const lineMessageId = buildImportedMessageUniqueId(threadId, msg);
      const fingerprint = buildImportedMessageFingerprint(threadId, msg);
      const hasSticker = !!(msg.stickerPackageId && msg.stickerId);
      const hasImage = !hasSticker && (msg.imageUrls || []).length > 0;
      const imageUrl = hasImage ? msg.imageUrls![0] : "";
      const type = hasSticker ? "STICKER" : hasImage && !msg.text ? "IMAGE" : "TEXT";
      const japanese = msg.text || (hasSticker ? "[贴图]" : hasImage ? "[图片]" : "[空消息]");

      const result = await ingestCustomerMessage({
        customerId: threadId,
        bridgeThreadId: threadId,
        originalName: incomingName,
        noteName: "",
        avatar: avatarUrl,
        type,
        japanese,
        imageUrl,
        stickerPackageId: hasSticker ? msg.stickerPackageId : "",
        stickerId: hasSticker ? msg.stickerId : "",
        lineMessageId,
        fingerprint,
        skipTranslate: true,
        sentAt: msg.sentAtIso,
        strictSentAt: true,
      });

      if (!result?.created) continue;

      importedCount += 1;
      const createdMessageId = result.message?.id || "";
      if (mode === "live" && type === "TEXT" && createdMessageId) {
        latestLiveTextMessageId = createdMessageId;
        translationQueuedMessageIds.push(createdMessageId);
      }
    }

    if (importedCount > 0 || customerUpsert.created || customerUpsert.profileChanged || customerUpsert.relationshipChanged) {
      await publishRealtimeRefresh({
        customerId: customer.id,
        reason:
          importedCount > 0
            ? "bridge-inbound-message"
            : customerUpsert.relationshipChanged
              ? "bridge-thread-status"
              : "bridge-customer-updated",
        scopes: ["workspace", "list"],
      });
    }

    for (const messageId of translationQueuedMessageIds) {
      await queueInboundTranslation({
        customerId: customer.id,
        targetMessageId: messageId,
      });
    }

    if (mode === "live" && latestLiveTextMessageId) {
      await queueInboundAutomation({
        customerId: customer.id,
        targetMessageId: latestLiveTextMessageId,
      });
    }

    return NextResponse.json({
      ok: true,
      mode,
      customer: {
        id: customer.id,
        lineUserId: customer.lineUserId,
        bridgeThreadId: customer.bridgeThreadId,
        originalName: customer.originalName,
        remarkName: customer.remarkName,
        lineRelationshipStatus: customer.lineRelationshipStatus,
      },
      importedCount,
      translationQueuedCount: translationQueuedMessageIds.length,
      aiQueued: mode === "live" && !!latestLiveTextMessageId,
    });
  } catch (error) {
    console.error("POST /api/bridge/inbound error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
