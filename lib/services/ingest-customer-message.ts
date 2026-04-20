import { MessageRole, MessageSource, MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildDefaultRemarkName } from "@/lib/customers/default-remark-name";
import { resolveIngestEventTime } from "@/lib/services/ingest-time";

export type IngestCustomerMessageInput = {
  customerId?: string;
  bridgeThreadId?: string;
  originalName?: string;
  noteName?: string;
  avatar?: string;
  type?: "TEXT" | "IMAGE" | "STICKER";
  japanese?: string;
  imageUrl?: string;
  stickerPackageId?: string;
  stickerId?: string;
  lineMessageId?: string;
  fingerprint?: string;
  skipTranslate?: boolean;
  sentAt?: string | Date;
  strictSentAt?: boolean;
};

export async function ingestCustomerMessage(input: IngestCustomerMessageInput) {
  const lineUserId = String(input.customerId || "").trim();
  const bridgeThreadId = String(input.bridgeThreadId || "").trim();
  const identity = bridgeThreadId || lineUserId;
  const originalName = String(input.originalName || "").trim();
  const remarkName = String(input.noteName || "").trim();
  const avatar = String(input.avatar || "").trim();
  const type =
    input.type === "IMAGE"
      ? MessageType.IMAGE
      : input.type === "STICKER"
        ? MessageType.STICKER
        : MessageType.TEXT;
  const japanese = String(input.japanese || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const stickerPackageId = String(input.stickerPackageId || "").trim();
  const stickerId = String(input.stickerId || "").trim();
  const lineMessageId = String(input.lineMessageId || "").trim();
  const fingerprint = String(input.fingerprint || "").trim();
  const skipTranslate = input.skipTranslate === true;
  const eventTime = resolveIngestEventTime({
    sentAt: input.sentAt,
    strictSentAt: input.strictSentAt,
  });

  if (!identity) {
    throw new Error("missing customerId / bridgeThreadId");
  }
  if (type === MessageType.TEXT && !japanese) {
    throw new Error("TEXT message missing japanese");
  }
  if (type === MessageType.IMAGE && !imageUrl && !japanese) {
    throw new Error("IMAGE message missing imageUrl");
  }
  if (type === MessageType.STICKER && (!stickerPackageId || !stickerId)) {
    throw new Error("STICKER message missing stickerPackageId / stickerId");
  }

  const dedupeOr = [] as Array<Record<string, string>>;
  if (lineMessageId) dedupeOr.push({ lineMessageId });
  if (fingerprint) dedupeOr.push({ fingerprint });

  if (dedupeOr.length) {
    const existingMessage = await prisma.message.findFirst({ where: { OR: dedupeOr } });
    if (existingMessage) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { id: existingMessage.customerId },
        select: {
          id: true,
          lineUserId: true,
          bridgeThreadId: true,
          originalName: true,
          remarkName: true,
          avatarUrl: true,
        },
      });

      return {
        ok: true,
        created: false,
        line: "duplicate message skipped",
        model: process.env.HELPER_MODEL || "",
        translated: !!existingMessage.chineseText,
        translateError: "",
        customer: existingCustomer,
        message: existingMessage,
      };
    }
  }

  const safeOriginalName = originalName || undefined;
  const safeRemarkName = remarkName || undefined;
  const safeAvatar = avatar.startsWith("http") ? avatar : undefined;

  const customer = bridgeThreadId
    ? await prisma.customer.upsert({
        where: { bridgeThreadId },
        update: {
          lineUserId: lineUserId || bridgeThreadId,
          originalName: safeOriginalName || undefined,
          avatarUrl: safeAvatar || undefined,
        },
        create: {
          bridgeThreadId,
          lineUserId: lineUserId || bridgeThreadId,
          originalName: safeOriginalName || bridgeThreadId,
          remarkName: safeRemarkName || buildDefaultRemarkName(originalName, bridgeThreadId || lineUserId, eventTime),
          avatarUrl: safeAvatar || null,
        },
        select: {
          id: true,
          lineUserId: true,
          bridgeThreadId: true,
          originalName: true,
          remarkName: true,
          avatarUrl: true,
          lastMessageAt: true,
          lastInboundMessageAt: true,
        },
      })
    : await prisma.customer.upsert({
        where: { lineUserId },
        update: {
          originalName: safeOriginalName || undefined,
          avatarUrl: safeAvatar || undefined,
        },
        create: {
          lineUserId,
          originalName: safeOriginalName || lineUserId,
          remarkName: safeRemarkName || buildDefaultRemarkName(originalName, lineUserId, eventTime),
          avatarUrl: safeAvatar || null,
        },
        select: {
          id: true,
          lineUserId: true,
          bridgeThreadId: true,
          originalName: true,
          remarkName: true,
          avatarUrl: true,
          lastMessageAt: true,
          lastInboundMessageAt: true,
        },
      });

  const message = await prisma.message.create({
    data: {
      customerId: customer.id,
      role: MessageRole.CUSTOMER,
      type,
      source: MessageSource.LINE,
      lineMessageId: lineMessageId || null,
      fingerprint: fingerprint || null,
      japaneseText: japanese,
      chineseText: null,
      imageUrl: type === MessageType.IMAGE ? imageUrl || null : null,
      stickerPackageId: type === MessageType.STICKER ? stickerPackageId || null : null,
      stickerId: type === MessageType.STICKER ? stickerId || null : null,
      sentAt: eventTime,
    },
  });

  const customerUpdate: Record<string, unknown> = {
    unreadCount: { increment: 1 },
  };

  if (!customer.lastMessageAt || customer.lastMessageAt < eventTime) {
    customerUpdate.lastMessageAt = eventTime;
  }
  if (!customer.lastInboundMessageAt || customer.lastInboundMessageAt < eventTime) {
    customerUpdate.lastInboundMessageAt = eventTime;
  }

  await prisma.customer.update({
    where: { id: customer.id },
    data: customerUpdate,
  });

  await prisma.replyDraftSet.updateMany({
    where: {
      customerId: customer.id,
      selectedVariant: null,
      isStale: false,
    },
    data: {
      isStale: true,
      staleReason: "new-inbound-message",
      staleAt: new Date(),
    },
  });

  return {
    ok: true,
    created: true,
    line:
      type === MessageType.TEXT
        ? skipTranslate
          ? "text message ingested (translation async)"
          : "text message ingested"
        : type === MessageType.IMAGE
          ? "image message ingested"
          : "sticker message ingested",
    model: process.env.HELPER_MODEL || "",
    translated: false,
    translateError: "",
    customer: {
      id: customer.id,
      lineUserId: customer.lineUserId,
      bridgeThreadId: customer.bridgeThreadId,
      originalName: customer.originalName,
      remarkName: customer.remarkName,
      avatarUrl: customer.avatarUrl,
    },
    message,
  };
}
