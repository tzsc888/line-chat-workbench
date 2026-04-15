import { NextRequest, NextResponse } from "next/server";
import { dispatchDueScheduledMessages } from "@/lib/scheduled-outbound";
import { constantTimeEqual } from "@/lib/security/secret";

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("缺少 CRON_SECRET");
  }

  const bearer = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");

  if (bearer?.startsWith("Bearer ") && constantTimeEqual(bearer.slice(7), cronSecret)) return true;
  if (headerSecret && constantTimeEqual(headerSecret, cronSecret)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: "未授权" }, { status: 401 });
    }

    const result = await dispatchDueScheduledMessages();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("GET /api/cron/scheduled-messages error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
