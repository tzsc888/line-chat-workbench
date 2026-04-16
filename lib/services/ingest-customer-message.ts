import { MessageRole, MessageSource, MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";

function buildAutoRemarkName(originalName: string, lineUserId: string, now: Date) {
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
  const baseName = originalName.trim() || lineUserId.trim() || "未命名顾客";
  return `${year}.${month}.${day}${baseName}`;
}

export type IngestCustomerMessageInput = {
  customerId: string;
  originalName?: string;
  noteName?: string;
  avatar?: string;
  type?: "TEXT" | "IMAGE";
  japanese?: string;
  imageUrl?: string;
  lineMessageId?: string;
  skipTranslate?: boolean;
};

export async function ingestCustomerMessage(input: IngestCustomerMessageInput) {
  const lineUserId = String(input.customerId || "").trim();
  const originalName = String(input.originalName || "").trim();
  const remarkName = String(input.noteName || "").trim();
  const avatar = String(input.avatar || "").trim();
  const type = input.type === "IMAGE" ? MessageType.IMAGE : MessageType.TEXT;
  const japanese = String(input.japanese || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const lineMessageId = String(input.lineMessageId || "").trim();
  const skipTranslate = input.skipTranslate === true;

  if (!lineUserId) {
    throw new Error("缺少 customerId");
  }
  if (type === MessageType.TEXT && !japanese) {
    throw new Error("TEXT 消息缺少 japanese");
  }
  if (type === MessageType.IMAGE && !imageUrl && !japanese) {
    throw new Error("IMAGE 消息缺少 imageUrl");
  }

  if (lineMessageId) {
    const existingMessage = await prisma.message.findUnique({ where: { lineMessageId } });
    if (existingMessage) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { id: existingMessage.customerId },
        select: { id: true, lineUserId: true, originalName: true, remarkName: true, avatarUrl: true },
      });
      return {
        ok: true,
        line: "重复消息，已跳过重复入库",
        model: process.env.HELPER_MODEL || "",
        translated: !!existingMessage.chineseText,
        translateError: "",
        customer: existingCustomer,
        message: existingMessage,
      };
    }
  }

  const now = new Date();
  const customer = await prisma.customer.upsert({
    where: { lineUserId },
    update: {
      originalName: originalName || undefined,
      remarkName: remarkName || undefined,
      avatarUrl: avatar.startsWith("http") ? avatar : undefined,
      lastMessageAt: now,
      lastInboundMessageAt: now,
      unreadCount: { increment: 1 },
    },
    create: {
      lineUserId,
      originalName: originalName || lineUserId,
      remarkName: remarkName || buildAutoRemarkName(originalName, lineUserId, now),
      avatarUrl: avatar.startsWith("http") ? avatar : null,
      lastMessageAt: now,
      lastInboundMessageAt: now,
      unreadCount: 1,
    },
  });

  const message = await prisma.message.create({
    data: {
      customerId: customer.id,
      role: MessageRole.CUSTOMER,
      type,
      source: MessageSource.LINE,
      lineMessageId: lineMessageId || null,
      japaneseText: japanese,
      chineseText: null,
      imageUrl: type === MessageType.IMAGE ? imageUrl || null : null,
      sentAt: now,
    },
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
      staleAt: now,
    },
  });

  if (skipTranslate || type === MessageType.IMAGE) {
    return {
      ok: true,
      line: skipTranslate ? "已快速入库，跳过同步翻译" : "图片消息已入库",
      model: process.env.HELPER_MODEL || "",
      translated: false,
      translateError: "",
      customer: {
        id: customer.id,
        lineUserId: customer.lineUserId,
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
    line,
    model: process.env.HELPER_MODEL || "",
    translated,
    translateError,
    customer: {
      id: customer.id,
      lineUserId: customer.lineUserId,
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
