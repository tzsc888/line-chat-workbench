import { NextRequest, NextResponse } from "next/server";
import { LineRelationshipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ingestCustomerMessage } from "@/lib/services/ingest-customer-message";
import { runInboundAutomation } from "@/lib/inbound-automation";
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
}) {
  const safeIncomingName = sanitizeBridgeDisplayName(params.incomingName);
  const safeAvatarUrl = cleanBridgeText(params.avatarUrl);
  const now = new Date();

  return prisma.customer.upsert({
    where: { bridgeThreadId: params.threadId },
    update: {
      lineUserId: params.threadId,
      originalName: safeIncomingName || undefined,
      remarkName: safeIncomingName || undefined,
      avatarUrl: safeAvatarUrl || undefined,
      lineRelationshipStatus: params.relationshipStatus,
      lineRelationshipUpdatedAt: now,
      lineRefollowedAt: params.relationshipStatus === LineRelationshipStatus.ACTIVE ? now : undefined,
    },
    create: {
      bridgeThreadId: params.threadId,
      lineUserId: params.threadId,
      originalName: safeIncomingName || buildBridgePlaceholderName(params.threadId),
      remarkName: safeIncomingName || buildBridgePlaceholderName(params.threadId),
      avatarUrl: safeAvatarUrl || null,
      lineRelationshipStatus: params.relationshipStatus,
      lineRelationshipUpdatedAt: now,
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

    const customer = await upsertBridgeCustomer({
      threadId,
      incomingName,
      avatarUrl,
      relationshipStatus,
    });

    const normalizedMessages = (Array.isArray(body.messages) ? body.messages : [])
      .map(normalizeBridgeMessage)
      .filter((msg) => msg.kind === "chat" && msg.side === "inbound")
      .sort((a, b) => new Date(a.sentAtIso).getTime() - new Date(b.sentAtIso).getTime());

    validateInboundBridgeMessages(normalizedMessages);

    let importedCount = 0;
    let latestLiveMessageId = "";

    for (const msg of normalizedMessages) {
      const lineMessageId = buildImportedMessageUniqueId(threadId, msg);
      const fingerprint = buildImportedMessageFingerprint(threadId, msg);
      const hasImage = (msg.imageUrls || []).length > 0;
      const imageUrl = hasImage ? msg.imageUrls![0] : "";
      const type = hasImage && !msg.text ? "IMAGE" : "TEXT";
      const japanese = msg.text || (hasImage ? "[图片]" : "[空消息]");

      const result = await ingestCustomerMessage({
        customerId: threadId,
        bridgeThreadId: threadId,
        originalName: incomingName,
        noteName: incomingName,
        avatar: avatarUrl,
        type,
        japanese,
        imageUrl,
        lineMessageId,
        fingerprint,
        skipTranslate: mode !== "live",
        sentAt: msg.sentAtIso,
        strictSentAt: true,
      });

      if (result?.created) {
        importedCount += 1;
        if (type === "TEXT") {
          latestLiveMessageId = result.message?.id || latestLiveMessageId;
        }
      }
    }

    if (mode === "live" && latestLiveMessageId) {
      await runInboundAutomation({
        customerId: customer.id,
        targetMessageId: latestLiveMessageId,
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
      aiTriggered: mode === "live" && !!latestLiveMessageId,
    });
  } catch (error) {
    console.error("POST /api/bridge/inbound error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
