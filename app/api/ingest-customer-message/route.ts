import { NextRequest, NextResponse } from "next/server";
import { queueInboundTranslation, runInboundAutomation } from "@/lib/inbound-automation";
import { isFirstInboundTextMessage } from "@/lib/inbound/first-inbound";
import { decideInboundTriggerPolicy } from "@/lib/inbound/trigger-policy";
import { ingestCustomerMessage } from "@/lib/services/ingest-customer-message";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await ingestCustomerMessage(body);
    const messageTypeRaw = String(body?.type || "TEXT").toUpperCase();
    const messageType = messageTypeRaw === "IMAGE" ? "IMAGE" : messageTypeRaw === "STICKER" ? "STICKER" : "TEXT";
    const mode = String(body?.mode || "live").toLowerCase() === "live" ? "live" : "non_live";
    const triggerDecision = decideInboundTriggerPolicy({
      mode,
      messageType,
      created: !!result?.created,
      isFirstInboundText:
        messageType === "TEXT" &&
        !!result?.created &&
        !!result?.message?.id &&
        !!result?.customer?.id &&
        await isFirstInboundTextMessage({
          customerId: result.customer.id,
          messageId: result.message.id,
          sentAt: result.message.sentAt,
        }),
    });

    if (
      triggerDecision.shouldQueueTranslation &&
      result?.message?.id &&
      result?.customer?.id &&
      body?.queueTranslate !== false
    ) {
      await queueInboundTranslation({
        customerId: result.customer.id,
        targetMessageId: result.message.id,
      });
    }

    if (
      triggerDecision.shouldQueueWorkflow &&
      result?.message?.id &&
      result?.customer?.id &&
      body?.queueAutomation === true
    ) {
      await runInboundAutomation({
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
