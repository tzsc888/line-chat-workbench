import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security/secret";
import { runDataRetentionCleanup } from "@/lib/maintenance/retention";
import { isLegacyEndpointEnabled, legacyEndpointDisabledResponse } from "@/lib/legacy-endpoint-toggle";

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
    // Legacy cron entry: disabled by default to avoid accidental scheduler traffic and retention scans.
    // To re-enable, set ENABLE_LEGACY_CRON_MAINTENANCE=true.
    if (!isLegacyEndpointEnabled("ENABLE_LEGACY_CRON_MAINTENANCE")) {
      return legacyEndpointDisabledResponse("cron_maintenance");
    }

    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const result = await runDataRetentionCleanup();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
