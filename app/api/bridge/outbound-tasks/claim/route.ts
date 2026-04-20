import { NextRequest, NextResponse } from "next/server";
import { claimNextOutboundTask, parseBridgeAuthHeader } from "@/lib/bridge-outbound";

export async function POST(req: NextRequest) {
  try {
    if (!parseBridgeAuthHeader(req.headers.get("x-bridge-secret"))) {
      return NextResponse.json({ ok: false, error: "bridge auth failed" }, { status: 401 });
    }

    const task = await claimNextOutboundTask();
    if (!task) {
      return NextResponse.json({ ok: true, task: null });
    }

    return NextResponse.json({
      ok: true,
      task: {
        id: task.id,
        bridgeThreadId: task.bridgeThreadId,
        status: task.status,
        attemptCount: task.attemptCount,
        customer: task.customer,
        message: {
          id: task.message.id,
          type: task.message.type,
          japaneseText: task.message.japaneseText,
          imageUrl: task.message.imageUrl,
          stickerPackageId: task.message.stickerPackageId,
          stickerId: task.message.stickerId,
          source: task.message.source,
        },
      },
    });
  } catch (error) {
    console.error("POST /api/bridge/outbound-tasks/claim error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
