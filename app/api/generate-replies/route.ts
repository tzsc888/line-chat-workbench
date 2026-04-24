import { NextRequest, NextResponse } from "next/server";
import { GenerationTaskTriggerSource } from "@prisma/client";
import {
  createGenerationTask,
  getGenerationTaskByScope,
  kickoffGenerationTask,
  processSpecificGenerationTask,
} from "@/lib/generation-tasks";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_MANUAL_WAIT_MS = 260_000;
const MIN_MANUAL_WAIT_MS = 5_000;
const MAX_MANUAL_WAIT_MS = 280_000;

function parseManualWaitMs() {
  const raw = Number(process.env.GENERATE_REPLIES_MANUAL_WAIT_MS || "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MANUAL_WAIT_MS;
  return Math.max(MIN_MANUAL_WAIT_MS, Math.min(MAX_MANUAL_WAIT_MS, Math.floor(raw)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorDetailsJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now();
  try {
    const body = await req.json();
    const customerId = String(body.customerId || "").trim();
    if (!customerId) {
      return NextResponse.json({ ok: false, error: "missing customerId" }, { status: 400 });
    }
    console.info(`[generate-replies] api started customer=${customerId}`);

    const task = await createGenerationTask({
      customerId,
      rewriteInput: String(body.rewriteInput || "").trim(),
      targetMessageId: String(body.targetCustomerMessageId || "").trim() || null,
      autoMode: false,
      triggerSource: GenerationTaskTriggerSource.MANUAL_GENERATE,
    });

    const deadline = Date.now() + parseManualWaitMs();
    // Manual path prioritizes in-request completion; cron is fallback only.
    while (Date.now() < deadline) {
      const execution = await processSpecificGenerationTask(task.id);
      const latest = await getGenerationTaskByScope({ taskId: task.id, customerId });
      if (!latest) {
        return NextResponse.json(
          { ok: false, error: "task_not_found_after_execution", taskId: task.id },
          { status: 500 },
        );
      }

      if (latest.status === "SUCCEEDED") {
        const workflowResult =
          execution && "workflowResult" in execution ? (execution.workflowResult as Record<string, unknown>) : {};
        console.info(
          `[generate-replies] api succeeded customer=${customerId} task=${latest.id} total_elapsed_ms=${Math.max(
            0,
            Date.now() - requestStartedAt,
          )}`,
        );
        return NextResponse.json({
          ok: true,
          taskId: latest.id,
          status: latest.status,
          stage: latest.stage,
          suggestion1Ja: String(workflowResult?.suggestion1Ja || ""),
          suggestion1Zh: String(workflowResult?.suggestion1Zh || ""),
          suggestion2Ja: String(workflowResult?.suggestion2Ja || ""),
          suggestion2Zh: String(workflowResult?.suggestion2Zh || ""),
          draftSetId: String(workflowResult?.draftSetId || ""),
          reusedExistingDraft: Boolean(workflowResult?.reusedExistingDraft),
          translationStatus: String(workflowResult?.translationStatus || "succeeded"),
          translationErrorCode: String(workflowResult?.translationErrorCode || ""),
          translationErrorMessage: String(workflowResult?.translationErrorMessage || ""),
          line: String(workflowResult?.line || ""),
          model: String(workflowResult?.model || ""),
        });
      }

      if (latest.status === "FAILED") {
        const details = parseErrorDetailsJson(latest.errorDetailsJson);
        console.error(
          `[generate-replies] api failed customer=${customerId} task=${latest.id} code=${latest.errorCode || ""} stage=${latest.stage} total_elapsed_ms=${Math.max(
            0,
            Date.now() - requestStartedAt,
          )}`,
        );
        return NextResponse.json(
          {
            ok: false,
            taskId: latest.id,
            status: latest.status,
            stage: latest.stage,
            error: latest.errorMessage || "generation_task_failed",
            errorCode: latest.errorCode || "",
            failureReason: String(details?.failure_reason || ""),
            parsePhase: String(details?.parse_phase || ""),
            retryable: Boolean(details?.retryable),
            elapsedMs:
              Number(details?.elapsed_ms || details?.total_elapsed_ms || 0) > 0
                ? Number(details?.elapsed_ms || details?.total_elapsed_ms || 0)
                : 0,
          },
          { status: 502 },
        );
      }

      if ("reason" in execution && execution.reason === "retry-scheduled") {
        const waitMs = Math.min(1500, Math.max(400, (latest.nextRetryAt ? Date.parse(latest.nextRetryAt) - Date.now() : 800)));
        await sleep(waitMs);
        continue;
      }

      if ("reason" in execution && execution.reason === "task-not-claimable") {
        await sleep(400);
        continue;
      }

      await sleep(300);
    }

    kickoffGenerationTask(task.id);
    console.info(
      `[generate-replies] api switched-to-background customer=${customerId} task=${task.id} total_elapsed_ms=${Math.max(
        0,
        Date.now() - requestStartedAt,
      )}`,
    );
    return NextResponse.json(
      {
        ok: true,
        taskId: task.id,
        status: "RUNNING",
        stage: "manual-wait-timeout-fallback-background",
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
