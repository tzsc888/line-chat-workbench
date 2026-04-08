import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import {
  MessageRole,
  MessageSource,
  MessageType,
  MessageSendStatus,
  SuggestionVariant,
} from "@prisma/client";

type Props = {
  params: Promise<{ customerId: string }>;
};

async function pushLineMessages(to: string, messages: unknown[]) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to,
      messages,
    }),
  });

  const textBody = await response.text();
  if (!response.ok) {
    throw new Error(`LINE push 失败: HTTP ${response.status} - ${textBody}`);
  }
}

function buildLineMessages(params: { type: MessageType; japaneseText: string; imageUrl?: string | null }) {
  const messages: any[] = [];

  if (params.type === MessageType.TEXT) {
    messages.push({ type: "text", text: params.japaneseText });
    return messages;
  }

  if (!params.imageUrl) {
    throw new Error("图片消息缺少 imageUrl");
  }

  messages.push({
    type: "image",
    originalContentUrl: params.imageUrl,
    previewImageUrl: params.imageUrl,
  });

  if (params.japaneseText) {
    messages.push({ type: "text", text: params.japaneseText });
  }

  return messages;
}

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

    const japaneseText = String(body.japaneseText || "").trim();
    const chineseText = typeof body.chineseText === "string" ? body.chineseText.trim() : null;
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const type = body.type === "IMAGE" ? MessageType.IMAGE : MessageType.TEXT;
    const source = body.source === "AI_SUGGESTION" ? MessageSource.AI_SUGGESTION : MessageSource.MANUAL;
    const replyDraftSetId = typeof body.replyDraftSetId === "string" ? body.replyDraftSetId.trim() : "";
    const suggestionVariantRaw = typeof body.suggestionVariant === "string" ? body.suggestionVariant.trim() : "";
    const suggestionVariant =
      suggestionVariantRaw === SuggestionVariant.STABLE || suggestionVariantRaw === SuggestionVariant.ADVANCING
        ? suggestionVariantRaw
        : null;

    if (type === MessageType.TEXT && !japaneseText) {
      return NextResponse.json({ ok: false, error: "japaneseText 不能为空" }, { status: 400 });
    }

    if (type === MessageType.IMAGE && !imageUrl) {
      return NextResponse.json({ ok: false, error: "图片消息缺少 imageUrl" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, lineUserId: true },
    });

    if (!customer) {
      return NextResponse.json({ ok: false, error: "客户不存在" }, { status: 404 });
    }

    if (!customer.lineUserId) {
      return NextResponse.json({ ok: false, error: "当前客户没有 LINE userId，无法发送" }, { status: 400 });
    }

    const now = new Date();

    const message = await prisma.message.create({
      data: {
        customerId,
        role: MessageRole.OPERATOR,
        type,
        source,
        japaneseText,
        chineseText,
        imageUrl: type === MessageType.IMAGE ? imageUrl : null,
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

    try {
      const lineMessages = buildLineMessages({
        type,
        japaneseText,
        imageUrl: type === MessageType.IMAGE ? imageUrl : null,
      });

      await pushLineMessages(customer.lineUserId, lineMessages);

      const sentMessage = await prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: MessageSendStatus.SENT,
          sendError: null,
          failedAt: null,
        },
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
        await publishRealtimeRefresh({ customerId, reason: "outbound-message" });
      } catch (error) {
        console.error("Ably publish outbound-message error:", error);
      }

      return NextResponse.json({ ok: true, message: sentMessage });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedAt = new Date();

      const failedMessage = await prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: MessageSendStatus.FAILED,
          sendError: errorMessage,
          failedAt,
          lastAttemptAt: failedAt,
        },
      });

      try {
        await publishRealtimeRefresh({ customerId, reason: "outbound-message-failed" });
      } catch (ablyError) {
        console.error("Ably publish outbound-message-failed error:", ablyError);
      }

      return NextResponse.json(
        { ok: false, error: errorMessage, message: failedMessage },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("POST /api/customers/[customerId]/messages error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
