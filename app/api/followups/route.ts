import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type EffectiveBucket = "UNCONVERTED" | "VIP";
type EffectiveTier = "A" | "B" | "C";
type EffectiveState = "ACTIVE" | "DONE" | "PAUSED";

function getLatestPreview(message: {
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE";
  japaneseText: string;
}) {
  const baseText = message.type === "IMAGE" ? "[图片]" : message.japaneseText.trim() || "[空消息]";
  return `${message.role === "OPERATOR" ? "我：" : ""}${baseText}`;
}

function deriveBucket(customer: {
  isVip: boolean;
  followupBucket: EffectiveBucket | null;
}): EffectiveBucket {
  return customer.followupBucket || (customer.isVip ? "VIP" : "UNCONVERTED");
}

function deriveTier(customer: {
  isVip: boolean;
  stage: string;
  unreadCount: number;
  followupTier: EffectiveTier | null;
  lastInboundMessageAt: Date | null;
  lastOutboundMessageAt: Date | null;
}): EffectiveTier {
  if (customer.followupTier) return customer.followupTier;
  if (customer.isVip) return "A";
  if (customer.unreadCount > 0) return "A";
  if (["WAITING_PAYMENT", "NEGOTIATING", "INTERESTED"].includes(customer.stage)) return "A";
  if (["FOLLOWING_UP", "FIRST_CONTACT", "PAID", "AFTER_SALES"].includes(customer.stage)) return "B";
  return "C";
}

function deriveReason(customer: {
  followupReason: string | null;
  isVip: boolean;
  stage: string;
  unreadCount: number;
}): string {
  if (customer.followupReason?.trim()) return customer.followupReason.trim();
  if (customer.unreadCount > 0) return "有未读消息，建议优先处理";
  if (customer.isVip) return "已成交客户，建议持续跟进";
  if (["WAITING_PAYMENT", "NEGOTIATING"].includes(customer.stage)) return "接近成交，建议重点跟进";
  if (customer.stage === "INTERESTED") return "顾客有兴趣，建议保持跟进";
  return "常规跟进";
}

function deriveNextFollowupAt(customer: {
  nextFollowupAt: Date | null;
  lastMessageAt: Date | null;
  updatedAt: Date;
  isVip: boolean;
  stage: string;
  unreadCount: number;
  followupTier: EffectiveTier | null;
  lastInboundMessageAt: Date | null;
  lastOutboundMessageAt: Date | null;
}): Date | null {
  if (customer.nextFollowupAt) return customer.nextFollowupAt;

  const base = customer.lastMessageAt || customer.updatedAt;
  const tier = deriveTier(customer);
  const next = new Date(base);

  if (customer.isVip) {
    if (tier === "A") next.setDate(next.getDate() + 1);
    else if (tier === "B") next.setDate(next.getDate() + 3);
    else next.setDate(next.getDate() + 7);
  } else {
    if (tier === "A") next.setDate(next.getDate() + 1);
    else if (tier === "B") next.setDate(next.getDate() + 3);
    else next.setDate(next.getDate() + 14);
  }

  return next;
}

function deriveState(customer: {
  followupState: EffectiveState;
  nextFollowupAt: Date | null;
}): EffectiveState {
  return customer.followupState || (customer.nextFollowupAt ? "ACTIVE" : "DONE");
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const bucketFilter = searchParams.get("bucket") as EffectiveBucket | null;
    const tierFilter = searchParams.get("tier") as EffectiveTier | null;
    const stateFilter = searchParams.get("state") as EffectiveState | null;

    const customers = await prisma.customer.findMany({
      include: {
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
        },
        tags: {
          include: { tag: true },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const now = Date.now();

    const items = customers.map((customer) => {
      const bucket = deriveBucket(customer);
      const tier = deriveTier(customer);
      const nextFollowupAt = deriveNextFollowupAt(customer);
      const state = deriveState(customer);
      const reason = deriveReason(customer);
      const latestMessage = customer.messages[0] || null;
      const isOverdue = !!nextFollowupAt && nextFollowupAt.getTime() <= now && state === "ACTIVE";

      return {
        id: customer.id,
        lineUserId: customer.lineUserId,
        remarkName: customer.remarkName,
        originalName: customer.originalName,
        stage: customer.stage,
        isVip: customer.isVip,
        bucket,
        tier,
        state,
        reason,
        nextFollowupAt: nextFollowupAt ? nextFollowupAt.toISOString() : null,
        lastFollowupHandledAt: customer.lastFollowupHandledAt?.toISOString() || null,
        unreadCount: customer.unreadCount,
        lastMessageAt: customer.lastMessageAt?.toISOString() || null,
        isOverdue,
        latestMessage: latestMessage
          ? {
              id: latestMessage.id,
              role: latestMessage.role,
              type: latestMessage.type,
              sentAt: latestMessage.sentAt.toISOString(),
              previewText: getLatestPreview(latestMessage),
            }
          : null,
      };
    });

    const filtered = items
      .filter((item) => (bucketFilter ? item.bucket === bucketFilter : true))
      .filter((item) => (tierFilter ? item.tier === tierFilter : true))
      .filter((item) => (stateFilter ? item.state === stateFilter : true))
      .sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        const aNext = a.nextFollowupAt ? new Date(a.nextFollowupAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bNext = b.nextFollowupAt ? new Date(b.nextFollowupAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (aNext !== bNext) return aNext - bNext;
        const aLast = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bLast = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bLast - aLast;
      });

    const counts = {
      UNCONVERTED: {
        A: items.filter((item) => item.bucket === "UNCONVERTED" && item.tier === "A" && item.state !== "DONE").length,
        B: items.filter((item) => item.bucket === "UNCONVERTED" && item.tier === "B" && item.state !== "DONE").length,
        C: items.filter((item) => item.bucket === "UNCONVERTED" && item.tier === "C" && item.state !== "DONE").length,
      },
      VIP: {
        A: items.filter((item) => item.bucket === "VIP" && item.tier === "A" && item.state !== "DONE").length,
        B: items.filter((item) => item.bucket === "VIP" && item.tier === "B" && item.state !== "DONE").length,
        C: items.filter((item) => item.bucket === "VIP" && item.tier === "C" && item.state !== "DONE").length,
      },
      overdue: items.filter((item) => item.isOverdue).length,
    };

    return NextResponse.json({
      ok: true,
      items: filtered,
      counts,
    });
  } catch (error) {
    console.error("GET /api/followups error:", error);
    return NextResponse.json({ ok: false, error: "读取跟进列表失败" }, { status: 500 });
  }
}
