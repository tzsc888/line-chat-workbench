import { NextRequest, NextResponse } from "next/server";
import { publishRealtimeRefresh } from "@/lib/ably";
import { prisma } from "@/lib/prisma";
import { resolveFollowupView } from "@/lib/followup-rules";
import { failExpiredOutboundTasks } from "@/lib/bridge-outbound";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function GET(_: Request, { params }: Props) {
  try {
    await failExpiredOutboundTasks();

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
        scheduledMessages: {
          where: {
            status: {
              in: ["PENDING", "PROCESSING", "FAILED"],
            },
          },
          orderBy: {
            scheduledFor: "asc",
          },
          take: 20,
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
      tags: customer.tags.map((item: { tag: { name: string } }) => item.tag.name),
      followupBucket: customer.followupBucket,
      followupTier: customer.followupTier,
      followupState: customer.followupState,
      nextFollowupBucket: customer.nextFollowupBucket,
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
          bridgeThreadId: customer.bridgeThreadId,
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
          riskTags: customer.riskTags,
          followup: {
            bucket: followup.bucket,
            tier: followup.tier,
            state: followup.state,
            reason: followup.reason,
            nextFollowupAt: followup.nextFollowupAt ? followup.nextFollowupAt.toISOString() : null,
            isOverdue: !!followup.nextFollowupAt && followup.state === "ACTIVE" && followup.nextFollowupAt.getTime() <= now,
          },
        },
        tags: customer.tags.map((item: { tag: { id: string; name: string; color: string | null } }) => ({
          id: item.tag.id,
          name: item.tag.name,
          color: item.tag.color,
        })),
        messages,
        scheduledMessages: customer.scheduledMessages.map((item) => ({
          id: item.id,
          type: item.type,
          source: item.source,
          japaneseText: item.japaneseText,
          chineseText: item.chineseText,
          imageUrl: item.imageUrl,
          scheduledFor: item.scheduledFor.toISOString(),
          status: item.status,
          sendError: item.sendError,
          retryCount: item.retryCount,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        latestCustomerMessageId: latestCustomerMessage?.id || null,
        latestReplyDraftSet: customer.replyDraftSets[0]
          ? {
              id: customer.replyDraftSets[0].id,
              customerId: customer.replyDraftSets[0].customerId,
              targetCustomerMessageId: customer.replyDraftSets[0].targetCustomerMessageId,
              extraRequirement: customer.replyDraftSets[0].extraRequirement,
              stableJapanese: customer.replyDraftSets[0].stableJapanese,
              stableChinese: customer.replyDraftSets[0].stableChinese,
              advancingJapanese: customer.replyDraftSets[0].advancingJapanese,
              advancingChinese: customer.replyDraftSets[0].advancingChinese,
              modelName: customer.replyDraftSets[0].modelName,
              translationPromptVersion: customer.replyDraftSets[0].translationPromptVersion,
              analysisPromptVersion: customer.replyDraftSets[0].analysisPromptVersion,
              generationPromptVersion: customer.replyDraftSets[0].generationPromptVersion,
              reviewPromptVersion: customer.replyDraftSets[0].reviewPromptVersion,
              sceneType: customer.replyDraftSets[0].sceneType,
              routeType: customer.replyDraftSets[0].routeType,
              replyGoal: customer.replyDraftSets[0].replyGoal,
              pushLevel: customer.replyDraftSets[0].pushLevel,
              differenceNote: customer.replyDraftSets[0].differenceNote,
              generationBriefJson: customer.replyDraftSets[0].generationBriefJson,
              reviewFlagsJson: customer.replyDraftSets[0].reviewFlagsJson,
              programChecksJson: customer.replyDraftSets[0].programChecksJson,
              aiReviewJson: customer.replyDraftSets[0].aiReviewJson,
              finalGateJson: customer.replyDraftSets[0].finalGateJson,
              selfCheckJson: customer.replyDraftSets[0].selfCheckJson,
              recommendedVariant: customer.replyDraftSets[0].recommendedVariant,
              isStale: customer.replyDraftSets[0].isStale,
              staleReason: customer.replyDraftSets[0].staleReason,
              staleAt: customer.replyDraftSets[0].staleAt?.toISOString() || null,
              selectedVariant: customer.replyDraftSets[0].selectedVariant,
              selectedAt: customer.replyDraftSets[0].selectedAt?.toISOString() || null,
              createdAt: customer.replyDraftSets[0].createdAt.toISOString(),
              updatedAt: customer.replyDraftSets[0].updatedAt.toISOString(),
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