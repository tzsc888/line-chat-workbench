import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildManualCopyPromptBundle } from "@/lib/ai/manual-reply-prompt-builder";
import { resolveLatestCustomerMessageForTurn } from "@/lib/services/generate-replies-workflow-core";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const customerId = String(body?.customerId || "").trim();
    const rewriteInput = String(body?.rewriteInput || "").trim();
    const requestedTargetMessageId = String(body?.targetCustomerMessageId || "").trim() || null;

    if (!customerId) {
      return NextResponse.json({ ok: false, error: "missing customerId" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        messages: { orderBy: [{ sentAt: "asc" }, { id: "asc" }] },
        tags: { include: { tag: true } },
      },
    });
    if (!customer) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }

    const messages = [...customer.messages];
    const latestCustomerMessage = resolveLatestCustomerMessageForTurn(messages, requestedTargetMessageId);
    if (!latestCustomerMessage) {
      return NextResponse.json({ ok: false, error: "target_customer_message_not_found" }, { status: 404 });
    }

    const copyText = buildManualCopyPromptBundle({
      latestMessage: latestCustomerMessage,
      recentMessages: messages,
      rewriteInput,
    });

    return NextResponse.json({ ok: true, copyText });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /(missing customerId)/.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message || "copy_prompt_failed" }, { status });
  }
}
