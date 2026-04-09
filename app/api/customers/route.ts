import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveFollowupView } from "@/lib/followup-rules";

function getLatestPreview(message: {
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE";
  japaneseText: string;
}) {
  const baseText = message.type === "IMAGE" ? "[图片]" : message.japaneseText.trim() || "[空消息]";
  return `${message.role === "OPERATOR" ? "我：" : ""}${baseText}`;
}

export async function GET() {
  try {
    const customers = await prisma.customer.findMany({
      select: {
        id: true,
        lineUserId: true,
        remarkName: true,
        originalName: true,
        avatarUrl: true,
        stage: true,
        isVip: true,
        pinnedAt: true,
        unreadCount: true,
        lineRelationshipStatus: true,
        lineRefollowedAt: true,
        aiCustomerInfo: true,
        aiCurrentStrategy: true,
        aiLastAnalyzedAt: true,
        lastMessageAt: true,
        lastInboundMessageAt: true,
        lastOutboundMessageAt: true,
        followupBucket: true,
        followupTier: true,
        followupState: true,
        followupReason: true,
        nextFollowupAt: true,
        updatedAt: true,
        tags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true,
            role: true,
            type: true,
            source: true,
            japaneseText: true,
            chineseText: true,
            sentAt: true,
          },
        },
      },
    });

    const sorted = [...customers].sort((a, b) => {
      const aPinned = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bPinned = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;

      if (aPinned || bPinned) {
        if (!aPinned) return 1;
        if (!bPinned) return -1;
        if (bPinned !== aPinned) return bPinned - aPinned;
      }

      const aLast = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bLast = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (bLast !== aLast) return bLast - aLast;

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const now = Date.now();

    const result = sorted.map((customer) => {
      const latestMessage = customer.messages[0] || null;
      const tagNames = customer.tags.map((item) => item.tag.name);
      const followup = resolveFollowupView({
        isVip: customer.isVip,
        stage: customer.stage,
        unreadCount: customer.unreadCount,
        lineRelationshipStatus: customer.lineRelationshipStatus,
        lineRefollowedAt: customer.lineRefollowedAt,
        remarkName: customer.remarkName,
        tags: tagNames,
        followupBucket: customer.followupBucket,
        followupTier: customer.followupTier,
        followupState: customer.followupState,
        nextFollowupAt: customer.nextFollowupAt,
        followupReason: customer.followupReason,
        lastMessageAt: customer.lastMessageAt,
        lastInboundMessageAt: customer.lastInboundMessageAt,
        lastOutboundMessageAt: customer.lastOutboundMessageAt,
      });

      return {
        id: customer.id,
        lineUserId: customer.lineUserId,
        remarkName: customer.remarkName,
        originalName: customer.originalName,
        avatarUrl: customer.avatarUrl,
        stage: customer.stage,
        isVip: customer.isVip,
        pinnedAt: customer.pinnedAt,
        unreadCount: customer.unreadCount,
        lineRelationshipStatus: customer.lineRelationshipStatus,
        lineRefollowedAt: customer.lineRefollowedAt,
        aiCustomerInfo: customer.aiCustomerInfo,
        aiCurrentStrategy: customer.aiCurrentStrategy,
        aiLastAnalyzedAt: customer.aiLastAnalyzedAt,
        lastMessageAt: customer.lastMessageAt,
        followup: {
          bucket: followup.bucket,
          tier: followup.tier,
          state: followup.state,
          reason: followup.reason,
          nextFollowupAt: followup.nextFollowupAt ? followup.nextFollowupAt.toISOString() : null,
          isOverdue:
            !!followup.nextFollowupAt &&
            followup.state === "ACTIVE" &&
            followup.nextFollowupAt.getTime() <= now,
        },
        tags: customer.tags.map((item) => ({
          id: item.tag.id,
          name: item.tag.name,
          color: item.tag.color,
        })),
        latestMessage: latestMessage
          ? {
              id: latestMessage.id,
              role: latestMessage.role,
              type: latestMessage.type,
              source: latestMessage.source,
              japaneseText: latestMessage.japaneseText,
              chineseText: latestMessage.chineseText,
              sentAt: latestMessage.sentAt,
              previewText: getLatestPreview({
                role: latestMessage.role,
                type: latestMessage.type,
                japaneseText: latestMessage.japaneseText,
              }),
            }
          : null,
      };
    });

    return NextResponse.json({ ok: true, customers: result });
  } catch (error) {
    console.error("GET /api/customers error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "读取顾客列表失败",
      },
      { status: 500 }
    );
  }
}
