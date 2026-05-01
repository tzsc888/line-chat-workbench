import { NextRequest, NextResponse } from "next/server";
import { publishRealtimeRefresh } from "@/lib/ably";
import { prisma } from "@/lib/prisma";
import { failExpiredOutboundTasks } from "@/lib/bridge-outbound";
import { buildMessagePipelineStatuses } from "@/lib/ai/pipeline-status";
import { getActiveAiStrategyVersion } from "@/lib/ai/strategy";
import { resolveFollowupView } from "@/lib/followup-rules";

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
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }
    if (process.env.NODE_ENV !== "production") {
      console.info("[workspace-load] workspace-customer-unread", {
        customerId: customer.id,
        unreadCount: customer.unreadCount,
        source: "workspace-api:get",
      });
    }

    const messages = [...customer.messages].reverse();
    const latestCustomerMessage = [...messages].reverse().find((message) => message.role === "CUSTOMER") || null;
    const customerMessageIds = messages.filter((message) => message.role === "CUSTOMER").map((message) => message.id);

    const [pipelineJobs, pipelineDrafts] = await Promise.all([
      customerMessageIds.length
        ? prisma.automationJob.findMany({
            where: {
              customerId,
              targetMessageId: { in: customerMessageIds },
              kind: { in: ["INBOUND_TRANSLATION", "INBOUND_WORKFLOW"] },
            },
            select: {
              targetMessageId: true,
              kind: true,
              status: true,
              lastError: true,
              updatedAt: true,
              finishedAt: true,
            },
          })
        : Promise.resolve([]),
      customerMessageIds.length
        ? prisma.replyDraftSet.findMany({
            where: {
              customerId,
              targetCustomerMessageId: { in: customerMessageIds },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              targetCustomerMessageId: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const pipelineByMessageId = buildMessagePipelineStatuses({
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        type: message.type,
        chineseText: message.chineseText,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      })),
      jobs: pipelineJobs,
      drafts: pipelineDrafts,
    });

    const messagesWithPipeline = messages.map((message) => ({
      ...message,
      sentAt: message.sentAt.toISOString(),
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      lastAttemptAt: message.lastAttemptAt?.toISOString() || null,
      failedAt: message.failedAt?.toISOString() || null,
      aiPipeline: pipelineByMessageId.get(message.id) || null,
    }));

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
        aiStrategy: {
          version: getActiveAiStrategyVersion(),
        },
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
        tags: customer.tags.map((item: { tag: { id: string; name: string; color: string | null } }) => ({
          id: item.tag.id,
          name: item.tag.name,
          color: item.tag.color,
        })),
        messages: messagesWithPipeline,
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
              generationPromptVersion: customer.replyDraftSets[0].generationPromptVersion,
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
    return NextResponse.json({ ok: false, error: "failed_to_load_workspace" }, { status: 500 });
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
      return NextResponse.json({ ok: false, error: "no_updatable_fields" }, { status: 400 });
    }
    if (markReadInput && process.env.NODE_ENV !== "production") {
      const before = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, unreadCount: true },
      });
      console.info("[mark-read-api] before", {
        customerId,
        unreadCount: before?.unreadCount ?? null,
      });
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

    if (markReadInput && process.env.NODE_ENV !== "production") {
      console.info("[mark-read-api] after", {
        customerId,
        unreadCount: updatedCustomer.unreadCount,
        reason: "mark-read",
      });
    }

    return NextResponse.json({
      ok: true,
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("PATCH /api/customers/[customerId]/workspace error:", error);
    return NextResponse.json({ ok: false, error: "failed_to_update_customer" }, { status: 500 });
  }
}

