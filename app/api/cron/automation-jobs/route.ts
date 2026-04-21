import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingRealtimeRefreshOutbox } from "@/lib/ably";
import { processDueGenerationTasks } from "@/lib/generation-tasks";
import { processDueInboundAutomationJobs } from "@/lib/inbound-automation";
import { constantTimeEqual } from "@/lib/security/secret";

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("缂哄皯 CRON_SECRET");
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
    const jobs = await processDueInboundAutomationJobs();
    const generationTasks = await processDueGenerationTasks();
    const realtimeRefresh = await dispatchPendingRealtimeRefreshOutbox();
    return NextResponse.json({ ok: true, jobs, generationTasks, realtimeRefresh });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
