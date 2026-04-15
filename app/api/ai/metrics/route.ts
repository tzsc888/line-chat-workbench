import { NextRequest, NextResponse } from "next/server";
import { getAiEvalMetrics } from "@/lib/ai/metrics/eval-metrics";

export async function GET(req: NextRequest) {
  try {
    const days = Number.parseInt(req.nextUrl.searchParams.get("days") || "30", 10);
    const metrics = await getAiEvalMetrics(Number.isFinite(days) && days > 0 ? days : 30);
    return NextResponse.json({ ok: true, metrics });
  } catch (error) {
    console.error("GET /api/ai/metrics error:", error);
    return NextResponse.json({ ok: false, error: "读取 AI 评估指标失败" }, { status: 500 });
  }
}
