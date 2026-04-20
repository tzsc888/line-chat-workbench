import { NextRequest, NextResponse } from "next/server";
import { generateRepliesWorkflow } from "@/lib/services/generate-replies-workflow";
import { isAiStructuredOutputError } from "@/lib/ai/model-client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await generateRepliesWorkflow({
      customerId: String(body.customerId || "").trim(),
      rewriteInput: String(body.rewriteInput || "").trim(),
      targetCustomerMessageId: String(body.targetCustomerMessageId || "").trim() || null,
      autoMode: body.autoMode === true,
      publishRefresh: true,
      triggerSource: "MANUAL_GENERATE",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/generate-replies error:", error);
    if (isAiStructuredOutputError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "AI structured output invalid",
          errorCode: error.code,
          stage: error.stage,
          mode: error.mode,
        },
        { status: 502 },
      );
    }
    if (message === "generation_missing_japanese_reply" || message === "generation_missing_chinese_meaning") {
      return NextResponse.json(
        {
          ok: false,
          error: message,
          stage: "generation",
        },
        { status: 422 },
      );
    }
    const status = /(missing customerId|customer_not_found|target_customer_text_message_not_found)/.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
