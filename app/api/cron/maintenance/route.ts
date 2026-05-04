import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security/secret";
import { runDataRetentionCleanup } from "@/lib/maintenance/retention";
import { failExpiredOutboundTasks } from "@/lib/bridge-outbound";

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("missing CRON_SECRET");
  const bearer = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");
  if (bearer?.startsWith("Bearer ") && constantTimeEqual(bearer.slice(7), cronSecret)) return true;
  if (headerSecret && constantTimeEqual(headerSecret, cronSecret)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const [retentionResult, outboundTimeoutResult] = await Promise.allSettled([
      runDataRetentionCleanup(),
      failExpiredOutboundTasks({ limit: 50 }),
    ]);

    const retention =
      retentionResult.status === "fulfilled"
        ? { status: "fulfilled" as const, result: retentionResult.value }
        : { status: "rejected" as const, error: retentionResult.reason instanceof Error ? retentionResult.reason.message : String(retentionResult.reason) };
    const outboundTimeouts =
      outboundTimeoutResult.status === "fulfilled"
        ? { status: "fulfilled" as const, result: outboundTimeoutResult.value }
        : { status: "rejected" as const, error: outboundTimeoutResult.reason instanceof Error ? outboundTimeoutResult.reason.message : String(outboundTimeoutResult.reason) };

    if (retention.status === "rejected") {
      console.error("cron maintenance retention error:", retention.error);
    }
    if (outboundTimeouts.status === "rejected") {
      console.error("cron maintenance outbound timeout error:", outboundTimeouts.error);
    }

    const hasSuccess = retention.status === "fulfilled" || outboundTimeouts.status === "fulfilled";
    return NextResponse.json(
      {
        ok: hasSuccess,
        retention,
        outboundTimeouts,
      },
      { status: hasSuccess ? 200 : 500 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
