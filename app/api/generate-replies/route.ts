import { NextRequest, NextResponse } from "next/server";
import { generateRepliesWorkflow } from "@/lib/services/generate-replies-workflow";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await generateRepliesWorkflow({
      customerId: String(body.customerId || "").trim(),
      rewriteInput: String(body.rewriteInput || "").trim(),
      targetCustomerMessageId: String(body.targetCustomerMessageId || "").trim() || null,
      autoMode: body.autoMode === true,
      publishRefresh: true,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/generate-replies error:", error);
    const status = /(缺少 customerId|客户不存在|当前没有可生成建议的文本顾客消息)/.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
