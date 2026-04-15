import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { buildAnalysisContext } from "@/lib/ai/context-builder";
import { runAnalysisRouter } from "@/lib/ai/analysis-router-service";
import { applyAnalysisStateToCustomer } from "@/lib/ai/state-merge-service";
import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";
import type { ContextMessage } from "@/lib/ai/ai-types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const customerId = String(body.customerId || "").trim();
    if (!customerId) {
      return NextResponse.json({ ok: false, error: "缺少 customerId" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        tags: { include: { tag: true } },
        messages: { orderBy: { sentAt: "desc" }, take: 30 },
      },
    });

    if (!customer) {
      return NextResponse.json({ ok: false, error: "客户不存在" }, { status: 404 });
    }

    const messages = [...customer.messages].reverse() as ContextMessage[];
    const latestCustomerMessage = [...messages].reverse().find((message) => message.role === "CUSTOMER" && message.type === "TEXT");
    if (!latestCustomerMessage) {
      return NextResponse.json({ ok: false, error: "当前没有可分析的文本顾客消息" }, { status: 400 });
    }

    const previousMessage = [...messages].reverse().find((message) => message.id !== latestCustomerMessage.id);
    const translation = await translateCustomerJapaneseMessage({
      japaneseText: latestCustomerMessage.japaneseText,
      previousJapanese: previousMessage?.japaneseText,
      previousChinese: previousMessage?.chineseText || undefined,
    });

    if (!latestCustomerMessage.chineseText && translation.parsed.translation) {
      await prisma.message.update({
        where: { id: latestCustomerMessage.id },
        data: { chineseText: translation.parsed.translation },
      });
      latestCustomerMessage.chineseText = translation.parsed.translation;
    }

    const analysisContext = buildAnalysisContext({
      customer: {
        id: customer.id,
        remarkName: customer.remarkName,
        originalName: customer.originalName,
        isVip: customer.isVip,
        stage: String(customer.stage),
        aiCustomerInfo: customer.aiCustomerInfo,
        aiCurrentStrategy: customer.aiCurrentStrategy,
        followupTier: customer.followupTier,
        followupState: customer.followupState,
        followupBucket: customer.followupBucket,
        nextFollowupBucket: customer.nextFollowupBucket,
        lineRelationshipStatus: customer.lineRelationshipStatus,
        riskTags: customer.riskTags || [],
      },
      latestMessage: latestCustomerMessage,
      translation: translation.parsed,
      recentMessages: messages,
    });

    const analysis = await runAnalysisRouter(analysisContext);

    await applyAnalysisStateToCustomer({
      customerId: customer.id,
      previousCustomerInfo: customer.aiCustomerInfo,
      previousStrategy: customer.aiCurrentStrategy,
      previousRiskTags: customer.riskTags,
      isVip: customer.isVip,
      analysis: analysis.parsed,
    });

    try {
      await publishRealtimeRefresh({ customerId: customer.id, reason: "analysis-updated" });
    } catch (error) {
      console.error("publish analysis-updated error:", error);
    }

    return NextResponse.json({
      ok: true,
      line: analysis.line,
      model: analysis.model,
      analysis: analysis.parsed,
      translation: translation.parsed,
      promptVersions: {
        translation: translation.promptVersion,
        analysis: analysis.promptVersion,
      },
    });
  } catch (error) {
    console.error("POST /api/analyze-customer error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
