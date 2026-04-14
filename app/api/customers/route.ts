import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveFollowupView } from "@/lib/followup-rules";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getLatestPreview(message: {
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE";
  japaneseText: string;
}) {
  const baseText = message.type === "IMAGE" ? "[图片]" : message.japaneseText.trim() || "[空消息]";
  return `${message.role === "OPERATOR" ? "我：" : ""}${baseText}`;
}

const customerSelect = {
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
    orderBy: { sentAt: "desc" as const },
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
};

function mapCustomer(customer: any, now: number) {
  const latestMessage = customer.messages[0] || null;
  const tagNames = customer.tags.map((item: any) => item.tag.name);
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
    tags: customer.tags.map((item: any) => ({
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
}

function buildSearchWhere(keyword: string) {
  return {
    OR: [
      { remarkName: { contains: keyword, mode: "insensitive" as const } },
      { originalName: { contains: keyword, mode: "insensitive" as const } },
      {
        tags: {
          some: {
            tag: {
              name: { contains: keyword, mode: "insensitive" as const },
            },
          },
        },
      },
      {
        messages: {
          some: {
            OR: [
              { japaneseText: { contains: keyword, mode: "insensitive" as const } },
              { chineseText: { contains: keyword, mode: "insensitive" as const } },
            ],
          },
        },
      },
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    const page = parsePositiveInt(req.nextUrl.searchParams.get("page"), 1);
    const limit = Math.min(parsePositiveInt(req.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const keyword = req.nextUrl.searchParams.get("q")?.trim() || "";
    const skip = Math.max(0, (page - 1) * limit);
    const now = Date.now();

    const overdueFollowupCount = await prisma.customer.count({
      where: {
        followupState: "ACTIVE",
        nextFollowupAt: {
          lte: new Date(),
        },
      },
    });

    let customers: any[] = [];
    let hasMore = false;

    if (keyword) {
      const items = await prisma.customer.findMany({
        where: buildSearchWhere(keyword),
        orderBy: [{ pinnedAt: "desc" }, { lastMessageAt: "desc" }],
        skip,
        take: limit + 1,
        select: customerSelect,
      });
      hasMore = items.length > limit;
      customers = items.slice(0, limit);
    } else {
      const pinnedCustomers =
        page === 1
          ? await prisma.customer.findMany({
              where: {
                pinnedAt: {
                  not: null,
                },
              },
              orderBy: [{ pinnedAt: "desc" }, { lastMessageAt: "desc" }],
              select: customerSelect,
            })
          : [];

      const regularCustomers = await prisma.customer.findMany({
        where: {
          pinnedAt: null,
        },
        orderBy: [{ lastMessageAt: "desc" }],
        skip,
        take: limit + 1,
        select: customerSelect,
      });

      hasMore = regularCustomers.length > limit;
      customers = [...pinnedCustomers, ...regularCustomers.slice(0, limit)];
    }

    return NextResponse.json({
      ok: true,
      customers: customers.map((customer) => mapCustomer(customer, now)),
      hasMore,
      page,
      pageSize: limit,
      stats: {
        overdueFollowupCount,
      },
    });
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
