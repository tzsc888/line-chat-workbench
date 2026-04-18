import { MessageRole, MessageSource, MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";
import { resolveIngestEventTime } from "@/lib/services/ingest-time";

function buildAutoRemarkName(originalName: string, identity: string, now: Date) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((item) => item.type === "year")?.value || String(now.getFullYear()).slice(-2);
  const month = parts.find((item) => item.type === "month")?.value || String(now.getMonth() + 1);
  const day = parts.find((item) => item.type === "day")?.value || String(now.getDate());
  const baseName = originalName.trim() || identity.trim() || "未命名顾客";
  return `${year}.${month}.${day}${baseName}`;
}

export type IngestCustomerMessageInput = {
  customerId?: string;
  bridgeThreadId?: string;
  originalName?: string;
  noteName?: string;
  avatar?: string;
  type?: "TEXT" | "IMAGE";
  japanese?: string;
  imageUrl?: string;
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
  const type = input.type === "IMAGE" ? MessageType.IMAGE : MessageType.TEXT;
  const japanese = String(input.japanese || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const lineMessageId = String(input.lineMessageId || "").trim();
  const fingerprint = String(input.fingerprint || "").trim();
  const skipTranslate = input.skipTranslate === true;
  const eventTime = resolveIngestEventTime({
    sentAt: input.sentAt,
    strictSentAt: input.strictSentAt,
  });

  if (!identity) {
    throw new Error("缺少 customerId / bridgeThreadId");
  }
  if (type === MessageType.TEXT && !japanese) {
    throw new Error("TEXT 消息缺少 japanese");
  }
  if (type === MessageType.IMAGE && !imageUrl && !japanese) {
    throw new Error("IMAGE 消息缺少 imageUrl");
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
        line: "重复消息，已跳过重复入库",
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
          remarkName: safeRemarkName || undefined,
          avatarUrl: safeAvatar || undefined,
        },
        create: {
          bridgeThreadId,
          lineUserId: lineUserId || bridgeThreadId,
          originalName: safeOriginalName || bridgeThreadId,
          remarkName:
            safeRemarkName ||
            buildAutoRemarkName(originalName, bridgeThreadId || lineUserId, eventTime),
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
          remarkName: safeRemarkName || undefined,
          avatarUrl: safeAvatar || undefined,
        },
        create: {
          lineUserId,
          originalName: safeOriginalName || lineUserId,
          remarkName: safeRemarkName || buildAutoRemarkName(originalName, lineUserId, eventTime),
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

  if (skipTranslate || type === MessageType.IMAGE) {
    return {
      ok: true,
      created: true,
      line: skipTranslate ? "已快速入库，跳过同步翻译" : "图片消息已入库",
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

  let translated = false;
  let translateError = "";
  let line = "未调用翻译线路";
  let chinese = "";

  try {
    const translation = await translateCustomerJapaneseMessage({ japaneseText: japanese });
    line = translation.line;
    chinese = translation.parsed.translation;
    if (chinese) {
      translated = true;
      await prisma.message.update({
        where: { id: message.id },
        data: { chineseText: chinese },
      });
    }
  } catch (error) {
    translateError = String(error);
    console.error("ingestCustomerMessage translate error:", error);
  }

  return {
    ok: true,
    created: true,
    line,
    model: process.env.HELPER_MODEL || "",
    translated,
    translateError,
    customer: {
      id: customer.id,
      lineUserId: customer.lineUserId,
      bridgeThreadId: customer.bridgeThreadId,
      originalName: customer.originalName,
      remarkName: customer.remarkName,
      avatarUrl: customer.avatarUrl,
    },
    message: {
      ...message,
      chineseText: translated ? chinese : null,
    },
  };
}
