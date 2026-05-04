import type { Prisma } from "@prisma/client";
import { resolveFollowupView } from "@/lib/followup-rules";

function getLatestPreview(message: {
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  japaneseText: string;
}) {
  const baseText =
    message.type === "IMAGE"
      ? "[图片]"
      : message.type === "STICKER"
        ? "[贴图]"
        : message.japaneseText.trim() || "[空消息]";
  return `${message.role === "OPERATOR" ? "我：" : ""}${baseText}`;
}

export const customerListSelect = {
  id: true,
  lineUserId: true,
  bridgeThreadId: true,
  remarkName: true,
  originalName: true,
  avatarUrl: true,
  stage: true,
  isVip: true,
  pinnedAt: true,
  unreadCount: true,
  lineRelationshipStatus: true,
  lineRefollowedAt: true,
  lastMessageAt: true,
  lastInboundMessageAt: true,
  lastOutboundMessageAt: true,
  followupBucket: true,
  followupTier: true,
  followupState: true,
  nextFollowupBucket: true,
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

export type CustomerListRow = Prisma.CustomerGetPayload<{
  select: typeof customerListSelect;
}>;

export function mapCustomerListItem(customer: CustomerListRow, now: number) {
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
    nextFollowupBucket: customer.nextFollowupBucket,
    nextFollowupAt: customer.nextFollowupAt,
    followupReason: customer.followupReason,
    lastMessageAt: customer.lastMessageAt,
    lastInboundMessageAt: customer.lastInboundMessageAt,
    lastOutboundMessageAt: customer.lastOutboundMessageAt,
  });

  return {
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
      nextFollowupBucket: customer.nextFollowupBucket,
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
}

