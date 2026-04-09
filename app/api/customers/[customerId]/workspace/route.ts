import { NextRequest, NextResponse } from "next/server";
import { publishRealtimeRefresh } from "@/lib/ably";
import { prisma } from "@/lib/prisma";
import { resolveFollowupView } from "@/lib/followup-rules";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function GET(_: Request, { params }: Props) {
  try {
    const { customerId } = await params;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        messages: {
          orderBy: {
            sentAt: "desc",
          },
          take: 100,
        },
        replyDraftSets: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!customer) {
      return NextResponse.json({ ok: false, error: "客户不存在" }, { status: 404 });
    }

    const messages = [...customer.messages].reverse();
    const latestCustomerMessage = [...messages]
      .reverse()
      .find((message) => message.role === "CUSTOMER") || null;

    const followup = resolveFollowupView({
      isVip: customer.isVip,
      stage: customer.stage,
      unreadCount: customer.unreadCount,
      remarkName: customer.remarkName,
      tags: customer.tags.map((item) => item.tag.name),
      followupBucket: customer.followupBucket,
      followupTier: customer.followupTier,
      followupState: customer.followupState,
      nextFollowupAt: customer.nextFollowupAt,
      followupReason: customer.followupReason,
      lastMessageAt: customer.lastMessageAt,
      lastInboundMessageAt: customer.lastInboundMessageAt,
      lastOutboundMessageAt: customer.lastOutboundMessageAt,
    });
    const now = Date.now();

    return NextResponse.json({
      ok: true,
      workspace: {
        customer: {
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
            isOverdue: !!followup.nextFollowupAt && followup.state === "ACTIVE" && followup.nextFollowupAt.getTime() <= now,
          },
        },
        tags: customer.tags.map((item) => ({
          id: item.tag.id,
          name: item.tag.name,
          color: item.tag.color,
        })),
        messages,
        latestCustomerMessageId: latestCustomerMessage?.id || null,
        latestReplyDraftSet: customer.replyDraftSets[0]
          ? {
              ...customer.replyDraftSets[0],
              targetCustomerMessageId: customer.replyDraftSets[0].targetCustomerMessageId,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("GET /api/customers/[customerId]/workspace error:", error);
    return NextResponse.json({ ok: false, error: "读取顾客工作台失败" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Props) {
  try {
    const { customerId } = await params;
    const body = await req.json();

    const remarkNameInput = Object.prototype.hasOwnProperty.call(body, "remarkName")
      ? String(body.remarkName ?? "").trim()
      : undefined;
    const pinnedInput = typeof body.pinned === "boolean" ? body.pinned : undefined;
    const markReadInput = body.markRead === true;

    const data: {
      remarkName?: string | null;
      pinnedAt?: Date | null;
      unreadCount?: number;
    } = {};

    if (remarkNameInput !== undefined) {
      data.remarkName = remarkNameInput || null;
    }

    if (pinnedInput !== undefined) {
      data.pinnedAt = pinnedInput ? new Date() : null;
    }

    if (markReadInput) {
      data.unreadCount = 0;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: false, error: "缺少可更新字段" }, { status: 400 });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data,
      select: {
        id: true,
        remarkName: true,
        originalName: true,
        pinnedAt: true,
        unreadCount: true,
      },
    });

    try {
      await publishRealtimeRefresh({ customerId, reason: "customer-meta-updated" });
    } catch (error) {
      console.error("Ably publish customer-meta-updated error:", error);
    }

    return NextResponse.json({
      ok: true,
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("PATCH /api/customers/[customerId]/workspace error:", error);
    return NextResponse.json({ ok: false, error: "更新顾客信息失败" }, { status: 500 });
  }
}
