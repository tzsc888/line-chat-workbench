import { NextRequest, NextResponse } from "next/server";
import { completeOutboundTask, parseBridgeAuthHeader } from "@/lib/bridge-outbound";

type Props = { params: Promise<{ taskId: string }> };

export async function POST(req: NextRequest, { params }: Props) {
  try {
    if (!parseBridgeAuthHeader(req.headers.get("x-bridge-secret"))) {
      return NextResponse.json({ ok: false, error: "bridge auth failed" }, { status: 401 });
    }

    const { taskId } = await params;
    const body = await req.json().catch(() => ({}));
    const ok = body?.ok === true;
    const error = typeof body?.error === "string" ? body.error : "";

    const result = await completeOutboundTask({ taskId, ok, error });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("POST /api/bridge/outbound-tasks/[taskId]/complete error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
