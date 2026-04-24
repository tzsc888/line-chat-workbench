import { NextRequest, NextResponse } from "next/server";
import { dispatchDueScheduledMessages } from "@/lib/scheduled-outbound";
import { constantTimeEqual } from "@/lib/security/secret";
import { isLegacyEndpointEnabled, legacyEndpointDisabledResponse } from "@/lib/legacy-endpoint-toggle";

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("missing CRON_SECRET");
  }

  const bearer = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");

  if (bearer?.startsWith("Bearer ") && constantTimeEqual(bearer.slice(7), cronSecret)) return true;
  if (headerSecret && constantTimeEqual(headerSecret, cronSecret)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  try {
    // Legacy cron entry: disabled by default to avoid accidental scheduler traffic and DB dispatch scans.
    // To re-enable, set ENABLE_LEGACY_CRON_SCHEDULED_MESSAGES=true.
    if (!isLegacyEndpointEnabled("ENABLE_LEGACY_CRON_SCHEDULED_MESSAGES")) {
      return legacyEndpointDisabledResponse("cron_scheduled_messages");
    }

    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const result = await dispatchDueScheduledMessages();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("GET /api/cron/scheduled-messages error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
