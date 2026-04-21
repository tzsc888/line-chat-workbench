import { NextRequest, NextResponse } from "next/server";
import { GenerationTaskTriggerSource } from "@prisma/client";
import { createGenerationTask, kickoffGenerationTask } from "@/lib/generation-tasks";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const customerId = String(body.customerId || "").trim();
    if (!customerId) {
      return NextResponse.json({ ok: false, error: "missing customerId" }, { status: 400 });
    }

    const task = await createGenerationTask({
      customerId,
      rewriteInput: String(body.rewriteInput || "").trim(),
      targetMessageId: String(body.targetCustomerMessageId || "").trim() || null,
      autoMode: false,
      triggerSource: GenerationTaskTriggerSource.MANUAL_GENERATE,
    });

    // Best-effort immediate kickoff to avoid waiting for cron scan windows.
    kickoffGenerationTask(task.id);

    return NextResponse.json(
      {
        ok: true,
        taskId: task.id,
        status: task.status,
        stage: task.stage,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/generate-replies error:", error);
    const status = /(missing customerId)/.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
