import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EffectiveBucket,
  EffectiveTier,
  resolveFollowupView,
} from "@/lib/followup-rules";

function getLatestPreview(message: {
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE";
  japaneseText: string;
}) {
  const baseText = message.type === "IMAGE" ? "[图片]" : message.japaneseText.trim() || "[空消息]";
  return `${message.role === "OPERATOR" ? "我：" : ""}${baseText}`;
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const bucketFilter = searchParams.get("bucket") as EffectiveBucket | null;
    const tierFilter = searchParams.get("tier") as EffectiveTier | null;

    const customers = await prisma.customer.findMany({
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ pinnedAt: "desc" }, { lastMessageAt: "desc" }],
    });

    const now = Date.now();

    const allItems = customers.map((customer) => {
      const tagNames = customer.tags.map((item) => item.tag.name);
      const resolved = resolveFollowupView({
        isVip: customer.isVip,
        remarkName: customer.remarkName,
        tags: tagNames,
        stage: String(customer.stage),
        unreadCount: customer.unreadCount,
        followupBucket: customer.followupBucket as EffectiveBucket | null,
        followupTier: customer.followupTier as EffectiveTier | null,
        followupState: customer.followupState,
        followupReason: customer.followupReason,
        nextFollowupAt: customer.nextFollowupAt,
        lastMessageAt: customer.lastMessageAt,
        lastInboundMessageAt: customer.lastInboundMessageAt,
        lastOutboundMessageAt: customer.lastOutboundMessageAt,
      });
      const latestMessage = customer.messages[0] || null;
      const isOverdue =
        !!resolved.nextFollowupAt &&
        resolved.nextFollowupAt.getTime() <= now &&
        resolved.state === "ACTIVE";

      return {
        id: customer.id,
        lineUserId: customer.lineUserId,
        remarkName: customer.remarkName,
        originalName: customer.originalName,
        stage: customer.stage,
        isVip: customer.isVip,
        bucket: resolved.bucket,
        tier: resolved.tier,
        state: resolved.state,
        reason: resolved.reason,
        nextFollowupAt: resolved.nextFollowupAt ? resolved.nextFollowupAt.toISOString() : null,
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

    const counts = {
      UNCONVERTED: {
        A: allItems.filter((item) => item.bucket === "UNCONVERTED" && item.tier === "A").length,
        B: allItems.filter((item) => item.bucket === "UNCONVERTED" && item.tier === "B").length,
        C: allItems.filter((item) => item.bucket === "UNCONVERTED" && item.tier === "C").length,
      },
      VIP: {
        A: allItems.filter((item) => item.bucket === "VIP" && item.tier === "A").length,
        B: allItems.filter((item) => item.bucket === "VIP" && item.tier === "B").length,
        C: allItems.filter((item) => item.bucket === "VIP" && item.tier === "C").length,
      },
      overdue: allItems.filter((item) => item.isOverdue).length,
    };

    const items = allItems
      .filter((item) => !bucketFilter || item.bucket === bucketFilter)
      .filter((item) => !tierFilter || item.tier === tierFilter);

    return NextResponse.json({ ok: true, items, counts });
  } catch (error) {
    console.error("GET /api/followups error:", error);
    return NextResponse.json({ ok: false, error: "读取跟进列表失败" }, { status: 500 });
  }
}
