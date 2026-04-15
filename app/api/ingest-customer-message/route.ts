import { NextRequest, NextResponse } from "next/server";
import { ingestCustomerMessage } from "@/lib/services/ingest-customer-message";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await ingestCustomerMessage(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/ingest-customer-message error:", error);
    const status = /缺少|消息缺少/.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
