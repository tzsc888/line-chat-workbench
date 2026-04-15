export type EffectiveBucket = "UNCONVERTED" | "VIP";
export type EffectiveTier = "A" | "B" | "C";
export type EffectiveState = "ACTIVE" | "OBSERVING" | "WAITING_WINDOW" | "POST_PURCHASE_CARE" | "DONE" | "PAUSED";
export type FollowupTimingKey = "IMMEDIATE" | "TODAY" | "IN_1_DAY" | "IN_3_DAYS" | "IN_7_DAYS" | "NO_SET";

type FollowupRuleCustomer = {
  isVip?: boolean;
  stage?: string;
  unreadCount?: number;
  remarkName?: string | null;
  tags?: string[];
  lineRelationshipStatus?: string | null;
  lineRefollowedAt?: Date | null;
  followupBucket?: EffectiveBucket | null;
  followupTier?: EffectiveTier | null;
  followupState?: EffectiveState | null;
  nextFollowupBucket?: FollowupTimingKey | null;
  nextFollowupAt?: Date | null;
  followupReason?: string | null;
  lastMessageAt?: Date | null;
  lastInboundMessageAt?: Date | null;
  lastOutboundMessageAt?: Date | null;
};

const VIP_PATTERN = /vip/i;

export function hasVipMarker(input?: string | null) {
  return !!input && VIP_PATTERN.test(input);
}

export function hasVipSignal(customer: FollowupRuleCustomer) {
  if (customer.isVip) return true;
  if (hasVipMarker(customer.remarkName)) return true;
  return (customer.tags || []).some((tag) => hasVipMarker(tag));
}

export function deriveEffectiveBucket(customer: FollowupRuleCustomer): EffectiveBucket {
  if (hasVipSignal(customer)) return "VIP";
  if (customer.followupBucket === "UNCONVERTED" || customer.followupBucket === "VIP") {
    return customer.followupBucket;
  }
  return "UNCONVERTED";
}

export function deriveDefaultTier(customer: FollowupRuleCustomer): EffectiveTier {
  if (customer.followupTier === "A" || customer.followupTier === "B" || customer.followupTier === "C") {
    return customer.followupTier;
  }

  const bucket = deriveEffectiveBucket(customer);
  const stage = String(customer.stage || "");
  const unread = Number(customer.unreadCount || 0);
  const relationship = String(customer.lineRelationshipStatus || "ACTIVE");

  if (relationship === "UNFOLLOWED") return "C";

  if (bucket === "VIP") {
    if (unread > 0) return "A";
    if (["AFTER_SALES", "PAID"].includes(stage)) return "B";
    return "C";
  }

  if (unread > 0) return "A";
  if (["WAITING_PAYMENT", "NEGOTIATING", "INTERESTED"].includes(stage)) return "A";
  if (["FOLLOWING_UP", "FIRST_CONTACT", "NEW"].includes(stage)) return "B";
  return "C";
}

export function deriveDefaultTimingKey(customer: FollowupRuleCustomer): FollowupTimingKey {
  if (customer.nextFollowupBucket) return customer.nextFollowupBucket;

  const bucket = deriveEffectiveBucket(customer);
  const tier = deriveDefaultTier(customer);

  if (bucket === "VIP") {
    if (tier === "A") return "TODAY";
    if (tier === "B") return "IN_3_DAYS";
    return "IN_7_DAYS";
  }

  if (tier === "A") return "TODAY";
  if (tier === "B") return "IN_1_DAY";
  return "IN_7_DAYS";
}

export function timingKeyToNextFollowupAt(key: FollowupTimingKey, baseDate?: Date | null) {
  if (!key || key === "NO_SET") return null;

  const base = baseDate ? new Date(baseDate) : new Date();
  const next = new Date(base);

  if (key === "IMMEDIATE") return next;
  if (key === "TODAY") {
    next.setHours(next.getHours() + 2);
    return next;
  }
  if (key === "IN_1_DAY") {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (key === "IN_3_DAYS") {
    next.setDate(next.getDate() + 3);
    return next;
  }
  if (key === "IN_7_DAYS") {
    next.setDate(next.getDate() + 7);
    return next;
  }

  return null;
}

export function deriveDefaultReason(customer: FollowupRuleCustomer) {
  if (customer.followupReason?.trim()) return customer.followupReason.trim();

  const bucket = deriveEffectiveBucket(customer);
  const stage = String(customer.stage || "");
  const unread = Number(customer.unreadCount || 0);
  const relationship = String(customer.lineRelationshipStatus || "ACTIVE");

  if (relationship === "UNFOLLOWED") return "顾客已取消关注，暂不主动跟进";
  if (unread > 0) return "有新消息，建议优先处理";
  if (bucket === "VIP") return "已成交顾客，建议持续经营";
  if (["WAITING_PAYMENT", "NEGOTIATING"].includes(stage)) return "接近成交，建议重点跟进";
  if (stage === "INTERESTED") return "顾客兴趣较高，建议保持跟进";
  return "常规跟进";
}

export function deriveEffectiveState(customer: FollowupRuleCustomer): EffectiveState {
  if (
    customer.followupState === "ACTIVE" ||
    customer.followupState === "OBSERVING" ||
    customer.followupState === "WAITING_WINDOW" ||
    customer.followupState === "POST_PURCHASE_CARE" ||
    customer.followupState === "DONE" ||
    customer.followupState === "PAUSED"
  ) {
    return customer.followupState;
  }
  return "ACTIVE";
}

export function resolveFollowupView(customer: FollowupRuleCustomer) {
  const bucket = deriveEffectiveBucket(customer);
  const tier = deriveDefaultTier(customer);
  const state = deriveEffectiveState(customer);
  const reason = deriveDefaultReason(customer);

  const baseDate = customer.lastInboundMessageAt || customer.lastMessageAt || customer.lastOutboundMessageAt || new Date();
  const nextFollowupAt = customer.nextFollowupAt || timingKeyToNextFollowupAt(deriveDefaultTimingKey(customer), baseDate);

  return {
    bucket,
    tier,
    state,
    reason,
    nextFollowupAt,
  };
}
