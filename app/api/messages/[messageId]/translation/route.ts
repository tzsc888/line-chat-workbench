import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";

type Props = {
  params: Promise<{ messageId: string }>;
};

export async function PATCH(req: Request, { params }: Props) {
  try {
    const { messageId } = await params;
    const body = await req.json();

    const chineseText = String(body.chineseText || "").trim();

    if (!chineseText) {
      return NextResponse.json(
        {
          ok: false,
          error: "chineseText 不能为空",
        },
        { status: 400 }
      );
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        chineseText,
      },
      select: {
        id: true,
        customerId: true,
        chineseText: true,
      },
    });

    try {
      await publishRealtimeRefresh({
        customerId: updated.customerId,
        reason: "translation-updated",
      });
    } catch (error) {
      console.error("Ably publish translation-updated error:", error);
    }

    return NextResponse.json({
      ok: true,
      message: updated,
    });
  } catch (error) {
    console.error("PATCH /api/messages/[messageId]/translation error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}