import { NextRequest, NextResponse } from "next/server";
import { queueInboundTranslation } from "@/lib/inbound-automation";
import { ingestCustomerMessage } from "@/lib/services/ingest-customer-message";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await ingestCustomerMessage(body);

    if (
      result?.created &&
      result?.message?.id &&
      result?.customer?.id &&
      String(body?.type || "TEXT").toUpperCase() === "TEXT" &&
      body?.queueTranslate !== false
    ) {
      await queueInboundTranslation({
        customerId: result.customer.id,
        targetMessageId: result.message.id,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/ingest-customer-message error:", error);
    const status = /缺少|消息缺少/.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
