import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { queueOutboundMessageTask } from "@/lib/bridge-outbound";
import {
  MessageRole,
  MessageSource,
  MessageType,
  SuggestionVariant,
  MessageSendStatus,
} from "@prisma/client";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function GET(_: Request, { params }: Props) {
  try {
    const { customerId } = await params;

    const messages = await prisma.message.findMany({
      where: { customerId },
      orderBy: { sentAt: "asc" },
    });

    return NextResponse.json({ ok: true, messages });
  } catch (error) {
    console.error("GET /api/customers/[customerId]/messages error:", error);
    return NextResponse.json({ ok: false, error: "读取消息失败" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Props) {
  try {
    const { customerId } = await params;
    const body = await req.json();

    const japaneseTextRaw = typeof body.japaneseText === "string" ? body.japaneseText : "";
    const japaneseText = japaneseTextRaw.replace(/\r\n/g, "\n");
    const chineseText = typeof body.chineseText === "string" ? body.chineseText.trim() : null;
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const stickerPackageId = typeof body.stickerPackageId === "string" ? body.stickerPackageId.trim() : "";
    const stickerId = typeof body.stickerId === "string" ? body.stickerId.trim() : "";
    const type =
      body.type === "IMAGE"
        ? MessageType.IMAGE
        : body.type === "STICKER"
          ? MessageType.STICKER
          : MessageType.TEXT;
    const source = body.source === "AI_SUGGESTION" ? MessageSource.AI_SUGGESTION : MessageSource.MANUAL;
    const replyDraftSetId = typeof body.replyDraftSetId === "string" ? body.replyDraftSetId.trim() : "";
    const suggestionVariantRaw = typeof body.suggestionVariant === "string" ? body.suggestionVariant.trim() : "";
    const suggestionVariant =
      suggestionVariantRaw === SuggestionVariant.STABLE || suggestionVariantRaw === SuggestionVariant.ADVANCING
        ? suggestionVariantRaw
        : null;

    if (type === MessageType.TEXT && !japaneseText.trim()) {
      return NextResponse.json({ ok: false, error: "japaneseText 不能为空" }, { status: 400 });
    }

    if (type === MessageType.IMAGE && !imageUrl) {
      return NextResponse.json({ ok: false, error: "图片消息缺少 imageUrl" }, { status: 400 });
    }

    if (type === MessageType.STICKER && (!stickerPackageId || !stickerId)) {
      return NextResponse.json({ ok: false, error: "贴图消息缺少 stickerPackageId / stickerId" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, bridgeThreadId: true },
    });

    if (!customer) {
      return NextResponse.json({ ok: false, error: "客户不存在" }, { status: 404 });
    }

    if (!customer.bridgeThreadId) {
      return NextResponse.json({ ok: false, error: "当前客户没有 bridgeThreadId，无法发送" }, { status: 400 });
    }

    const now = new Date();

    const outboundJapaneseText =
      type === MessageType.TEXT ? japaneseText : type === MessageType.STICKER ? japaneseText.trim() || "[贴图]" : "";
    const outboundChineseText = type === MessageType.TEXT ? chineseText : null;

    const message = await prisma.message.create({
      data: {
        customerId,
        role: MessageRole.OPERATOR,
        type,
        source,
        japaneseText: outboundJapaneseText,
        chineseText: outboundChineseText,
        imageUrl: type === MessageType.IMAGE ? imageUrl : null,
        stickerPackageId: type === MessageType.STICKER ? stickerPackageId : null,
        stickerId: type === MessageType.STICKER ? stickerId : null,
        sentAt: now,
        deliveryStatus: MessageSendStatus.PENDING,
        lastAttemptAt: now,
      },
    });

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        lastMessageAt: now,
        lastOutboundMessageAt: now,
      },
    });

    const task = await queueOutboundMessageTask({
      messageId: message.id,
      customerId,
      bridgeThreadId: customer.bridgeThreadId,
    });

    if (source === MessageSource.AI_SUGGESTION && replyDraftSetId && suggestionVariant) {
      await prisma.replyDraftSet.updateMany({
        where: {
          id: replyDraftSetId,
          customerId,
        },
        data: {
          selectedVariant: suggestionVariant,
          selectedAt: now,
        },
      });
    }

    try {
      await publishRealtimeRefresh({ customerId, reason: "outbound-message-queued" });
    } catch (error) {
      console.error("Ably publish outbound-message-queued error:", error);
    }

    return NextResponse.json({ ok: true, message, taskId: task.id });
  } catch (error) {
    console.error("POST /api/customers/[customerId]/messages error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
