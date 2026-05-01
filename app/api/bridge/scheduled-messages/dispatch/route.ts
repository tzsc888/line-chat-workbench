import { NextRequest, NextResponse } from "next/server";
import { dispatchDueScheduledMessages } from "@/lib/scheduled-outbound";
import { parseBridgeAuthHeader } from "@/lib/bridge-outbound";

const DEFAULT_BATCH_SIZE = 20;

function parseBatchSize(value: string | null) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    if (!parseBridgeAuthHeader(req.headers.get("x-bridge-secret"))) {
      return NextResponse.json({ ok: false, error: "bridge auth failed" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const bodyBatchSize =
      body && typeof body === "object" && "batchSize" in body ? Number((body as { batchSize?: number }).batchSize) : NaN;
    const batchSize = Number.isFinite(bodyBatchSize)
      ? Math.max(1, Math.trunc(bodyBatchSize))
      : parseBatchSize(req.nextUrl.searchParams.get("batchSize"));

    const result = await dispatchDueScheduledMessages({ batchSize });
    return NextResponse.json({
      ok: true,
      serverNow: result.serverNow,
      batchSize: result.batchSize,
      dueCount: result.dueCount,
      pickedCount: result.pickedCount,
      dispatchedCount: result.dispatchedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      hasMoreDue: result.hasMoreDue,
      results: result.results,
    });
  } catch (error) {
    console.error("POST /api/bridge/scheduled-messages/dispatch error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
