export type EffectiveBucket = "UNCONVERTED" | "VIP";
export type EffectiveTier = "A" | "B" | "C";
export type EffectiveState = "ACTIVE" | "DONE" | "PAUSED";
export type FollowupTimingKey = "24H" | "2D" | "5D" | "7D" | "14D" | "NONE";

type FollowupRuleCustomer = {
  isVip?: boolean;
  stage?: string;
  unreadCount?: number;
  remarkName?: string | null;
  tags?: string[];
  followupBucket?: EffectiveBucket | null;
  followupTier?: EffectiveTier | null;
  followupState?: EffectiveState | null;
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
  const bucket = deriveEffectiveBucket(customer);
  const tier = deriveDefaultTier(customer);

  if (bucket === "VIP") {
    if (tier === "A") return "24H";
    if (tier === "B") return "5D";
    return "14D";
  }

  if (tier === "A") return "24H";
  if (tier === "B") return "2D";
  return "14D";
}

export function timingKeyToNextFollowupAt(key: FollowupTimingKey, baseDate?: Date | null) {
  if (!key || key === "NONE") return null;

  const base = baseDate ? new Date(baseDate) : new Date();
  const next = new Date(base);

  if (key === "24H") {
    next.setHours(next.getHours() + 24);
    return next;
  }
  if (key === "2D") {
    next.setDate(next.getDate() + 2);
    return next;
  }
  if (key === "5D") {
    next.setDate(next.getDate() + 5);
    return next;
  }
  if (key === "7D") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (key === "14D") {
    next.setDate(next.getDate() + 14);
    return next;
  }

  return null;
}

export function deriveDefaultReason(customer: FollowupRuleCustomer) {
  if (customer.followupReason?.trim()) return customer.followupReason.trim();

  const bucket = deriveEffectiveBucket(customer);
  const stage = String(customer.stage || "");
  const unread = Number(customer.unreadCount || 0);

  if (unread > 0) return "有新消息，建议优先处理";
  if (bucket === "VIP") return "已成交顾客，建议持续经营";
  if (["WAITING_PAYMENT", "NEGOTIATING"].includes(stage)) return "接近成交，建议重点跟进";
  if (stage === "INTERESTED") return "顾客兴趣较高，建议保持跟进";
  return "常规跟进";
}

export function deriveEffectiveState(customer: FollowupRuleCustomer): EffectiveState {
  if (customer.followupState === "ACTIVE" || customer.followupState === "DONE" || customer.followupState === "PAUSED") {
    return customer.followupState;
  }
  return "ACTIVE";
}

export function resolveFollowupView(customer: FollowupRuleCustomer) {
  const bucket = deriveEffectiveBucket(customer);
  const tier = deriveDefaultTier(customer);
  const state = deriveEffectiveState(customer);
  const reason = deriveDefaultReason(customer);

  const baseDate =
    customer.lastInboundMessageAt ||
    customer.lastMessageAt ||
    customer.lastOutboundMessageAt ||
    new Date();

  const nextFollowupAt = customer.nextFollowupAt || timingKeyToNextFollowupAt(deriveDefaultTimingKey(customer), baseDate);

  return {
    bucket,
    tier,
    state,
    reason,
    nextFollowupAt,
  };
}
