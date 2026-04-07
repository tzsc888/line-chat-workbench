import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { MessageRole, MessageSource, MessageType, SuggestionVariant } from "@prisma/client";

type Props = {
  params: Promise<{ customerId: string }>;
};

async function pushLineTextMessage(to: string, text: string) {
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
      messages: [{ type: "text", text }],
    }),
  });

  const textBody = await response.text();
  if (!response.ok) {
    throw new Error(`LINE push 失败: HTTP ${response.status} - ${textBody}`);
  }
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
    const type = body.type === "IMAGE" ? MessageType.IMAGE : MessageType.TEXT;
    const source = body.source === "AI_SUGGESTION" ? MessageSource.AI_SUGGESTION : MessageSource.MANUAL;
    const replyDraftSetId = typeof body.replyDraftSetId === "string" ? body.replyDraftSetId.trim() : "";
    const suggestionVariantRaw = typeof body.suggestionVariant === "string" ? body.suggestionVariant.trim() : "";
    const suggestionVariant =
      suggestionVariantRaw === SuggestionVariant.STABLE || suggestionVariantRaw === SuggestionVariant.ADVANCING
        ? suggestionVariantRaw
        : null;

    if (!japaneseText && type === MessageType.TEXT) {
      return NextResponse.json({ ok: false, error: "japaneseText 不能为空" }, { status: 400 });
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

    if (type === MessageType.TEXT) {
      await pushLineTextMessage(customer.lineUserId, japaneseText);
    }

    const message = await prisma.message.create({
      data: {
        customerId,
        role: MessageRole.OPERATOR,
        type,
        source,
        japaneseText,
        chineseText,
        sentAt: now,
      },
    });

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        lastMessageAt: now,
        lastOutboundMessageAt: now,
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

    return NextResponse.json({ ok: true, message });
  } catch (error) {
    console.error("POST /api/customers/[customerId]/messages error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
