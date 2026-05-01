import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { validateScheduleWindow, normalizeScheduledAtInput } from "@/lib/scheduled-outbound";
import { translateJapaneseToChinese } from "@/lib/translate";
import { MessageSource, MessageType, SuggestionVariant } from "@prisma/client";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function POST(req: Request, { params }: Props) {
  try {
    const { customerId } = await params;
    const body = await req.json();

    const japaneseTextRaw = typeof body.japaneseText === "string" ? body.japaneseText : "";
    const japaneseText = japaneseTextRaw.replace(/\r\n/g, "\n");
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const scheduledForRaw = typeof body.scheduledFor === "string" ? body.scheduledFor.trim() : "";
    const type = body.type === "IMAGE" ? MessageType.IMAGE : MessageType.TEXT;
    const source = body.source === "AI_SUGGESTION" ? MessageSource.AI_SUGGESTION : MessageSource.MANUAL;
    const replyDraftSetId = typeof body.replyDraftSetId === "string" ? body.replyDraftSetId.trim() : "";
    const suggestionVariantRaw = typeof body.suggestionVariant === "string" ? body.suggestionVariant.trim() : "";
    const suggestionVariant =
      suggestionVariantRaw === SuggestionVariant.STABLE || suggestionVariantRaw === SuggestionVariant.ADVANCING
        ? suggestionVariantRaw
        : null;

    if (type === MessageType.TEXT && !japaneseText.trim()) {
      return NextResponse.json({ ok: false, error: "请先输入要定时发送的内容" }, { status: 400 });
    }

    if (type === MessageType.IMAGE && !imageUrl) {
      return NextResponse.json({ ok: false, error: "定时发送图片时缺少 imageUrl" }, { status: 400 });
    }

    if (type === MessageType.IMAGE) {
      return NextResponse.json({ ok: false, error: "当前 bridge 第一阶段仅支持文字定时发送" }, { status: 400 });
    }

    if (!scheduledForRaw) {
      return NextResponse.json({ ok: false, error: "请选择定时发送时间" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        bridgeThreadId: true,
      },
    });

    if (!customer) {
      return NextResponse.json({ ok: false, error: "客户不存在" }, { status: 404 });
    }

    if (!customer.bridgeThreadId) {
      return NextResponse.json({ ok: false, error: "当前客户没有 bridgeThreadId，无法定时发送" }, { status: 400 });
    }

    const scheduledFor = normalizeScheduledAtInput(scheduledForRaw);
    validateScheduleWindow(scheduledFor);

    let chineseText: string | null = null;
    if (japaneseText.trim()) {
      try {
        const translateResult = await translateJapaneseToChinese(japaneseText);
        chineseText = translateResult.chinese || null;
      } catch (error) {
        console.error("scheduled message translate error:", error);
      }
    }

    const scheduledMessage = await prisma.scheduledMessage.create({
      data: {
        customerId,
        type,
        source,
        japaneseText,
        chineseText,
        imageUrl: null,
        scheduledFor,
        replyDraftSetId: replyDraftSetId || null,
        suggestionVariant,
      },
    });

    try {
      await publishRealtimeRefresh({ customerId, reason: "scheduled-message-created" });
    } catch (error) {
      console.error("Ably publish scheduled-message-created error:", error);
    }

    return NextResponse.json({ ok: true, scheduledMessage });
  } catch (error) {
    console.error("POST /api/customers/[customerId]/scheduled-messages error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
