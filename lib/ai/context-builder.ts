import type { ContextMessage, TranslationResult } from "./ai-types";
import { deriveObjectiveSalesFacts } from "../industry/core";
import { salesBrainPlaybook } from "./sales-brain-playbook";

type TimelineMessage = {
  message_id: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION" | "UNKNOWN";
  sent_at_iso: string;
  minutes_since_previous: number | null;
  minutes_since_key_operator_long_message: number | null;
  japanese_text: string;
};

type CurrentCustomerTurnMessage = {
  id: string;
  text: string;
  sent_at_iso: string;
};

function toMs(value: Date | string | undefined) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value: Date | string | undefined) {
  const ms = toMs(value);
  return new Date(ms || Date.now()).toISOString();
}

function getGenerationClock(timezone: string) {
  const now = new Date();
  const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });
  const nowJstText = jstFormatter.format(now);
  const hourJst = Number(hourFormatter.format(now));
  return {
    timezone,
    now_utc_iso: now.toISOString(),
    now_jst_text: nowJstText,
    hour_jst: Number.isFinite(hourJst) ? hourJst : null,
  };
}

function normalizeSource(source: ContextMessage["source"]) {
  if (source === "LINE" || source === "MANUAL" || source === "AI_SUGGESTION") return source;
  return "UNKNOWN";
}

function sortMessagesBySentAtAsc(messages: ContextMessage[]) {
  return messages
    .map((message, index) => ({ message, index, ms: toMs(message.sentAt) || 0 }))
    .sort((a, b) => {
      if (a.ms !== b.ms) return a.ms - b.ms;
      return a.index - b.index;
    })
    .map((item) => item.message);
}

function dedupeMessagesById(messages: ContextMessage[]) {
  const unique = new Map<string, ContextMessage>();
  for (const message of messages) {
    if (!message?.id) continue;
    unique.set(message.id, message);
  }
  return [...unique.values()];
}

function isVisibleOperatorBoundary(message: ContextMessage) {
  if (message.role !== "OPERATOR") return false;
  if (message.type === "TEXT") return !!String(message.japaneseText || "").trim();
  return message.type === "IMAGE";
}

function buildCurrentCustomerTurn(input: {
  orderedMessages: ContextMessage[];
  targetMessageId: string;
}) {
  const targetIndex = input.orderedMessages.findIndex((item) => item.id === input.targetMessageId);
  const cappedIndex = targetIndex >= 0 ? targetIndex : input.orderedMessages.length - 1;
  const bounded = input.orderedMessages.slice(0, Math.max(0, cappedIndex) + 1);

  let boundaryIndex = -1;
  for (let i = bounded.length - 1; i >= 0; i -= 1) {
    const candidate = bounded[i];
    if (candidate.id === input.targetMessageId) continue;
    if (isVisibleOperatorBoundary(candidate)) {
      boundaryIndex = i;
      break;
    }
  }

  const turnCustomerMessages = bounded
    .slice(boundaryIndex + 1)
    .filter((item) => item.role === "CUSTOMER")
    .map((item) => ({
      id: item.id,
      text: item.japaneseText || "",
      sent_at_iso: toIso(item.sentAt),
    } satisfies CurrentCustomerTurnMessage));

  const joinedText = turnCustomerMessages
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");

  const latestSentAt =
    turnCustomerMessages.length > 0
      ? turnCustomerMessages[turnCustomerMessages.length - 1].sent_at_iso
      : toIso(undefined);

  return {
    messages: turnCustomerMessages,
    joined_text: joinedText,
    message_count: turnCustomerMessages.length,
    latest_sent_at: latestSentAt,
  };
}

function buildTimelineMessages(input: {
  messages: ContextMessage[];
  keyOperatorLongMessageMs: number | null;
}) {
  const ordered = sortMessagesBySentAtAsc(input.messages.filter((item) => !!toMs(item.sentAt)));

  let previousMs: number | null = null;
  return ordered.map((message) => {
    const currentMs = toMs(message.sentAt) || Date.now();
    const minutesSincePrevious =
      previousMs == null ? null : Math.max(0, Math.round((currentMs - previousMs) / 60000));
    const minutesSinceKey =
      input.keyOperatorLongMessageMs == null
        ? null
        : Math.max(0, Math.round((currentMs - input.keyOperatorLongMessageMs) / 60000));

    previousMs = currentMs;

    return {
      message_id: message.id,
      role: message.role,
      type: message.type,
      source: normalizeSource(message.source),
      sent_at_iso: new Date(currentMs).toISOString(),
      minutes_since_previous: minutesSincePrevious,
      minutes_since_key_operator_long_message: minutesSinceKey,
      japanese_text: message.japaneseText || "",
    } satisfies TimelineMessage;
  });
}

function toJapaneseOnlyKeyOperatorLongMessage(
  value: ReturnType<typeof deriveObjectiveSalesFacts>["key_operator_long_message"],
) {
  if (!value) return null;
  return {
    message_id: value.message_id,
    role: value.role,
    type: value.type,
    source: value.source,
    sent_at_iso: value.sent_at_iso,
    japanese_text: value.japanese_text,
    minutes_since_key_message: value.minutes_since_key_message,
  };
}

function buildBusinessPosition(input: {
  isInitialReceptionPhase: boolean;
  isReplyToFreeReading: boolean;
  hasPaidOrder: boolean;
}) {
  if (input.hasPaidOrder) {
    return "Current position: post-payment follow-up; focus on paid-stage continuation, clarification, and trust continuity.";
  }
  if (input.isReplyToFreeReading) {
    return "Current position: post-free-reading follow-up; customer is responding to prior free reading context and is not paid yet.";
  }
  if (input.isInitialReceptionPhase) {
    return "Current position: initial reception; the customer has submitted consultation details and is waiting for the first human-like reception before the free reading.";
  }
  return "Current position: active pre-payment chat follow-up; continue natural turn-by-turn conversation and gradual progression.";
}

function buildSalesDirection(input: {
  isInitialReceptionPhase: boolean;
  isReplyToFreeReading: boolean;
  hitCtaOption: boolean;
  hasPaidOrder: boolean;
}) {
  if (input.hasPaidOrder) {
    return "Sales direction: stabilize paid-stage experience and answer current concerns; do not restart free-stage selling.";
  }
  if (input.isInitialReceptionPhase) {
    return "Current scene: initial reception after the customer has submitted consultation details. First acknowledge the most painful point and make them feel their message was carefully read. Do not ask for more details unless key information is clearly missing. Do not sell, quote, or write a formal reading. Close naturally by bridging to the free-reading direction, such as saying you will first look at the current flow based on what they shared.";
  }
  if (input.isReplyToFreeReading && input.hitCtaOption) {
    return "Sales direction: customer has entered a live interest window; follow their selected topic and move only half-step to one step.";
  }
  if (input.isReplyToFreeReading) {
    return "Sales direction: post-free-reading continuation; hold natural chat rhythm and progress gently instead of full-step conversion.";
  }
  return "Sales direction: follow the current customer turn naturally and move one small step forward when the window is clear.";
}

export function buildMainBrainGenerationContext(input: {
  customer: {
    id: string;
    stage: string;
    display_name: string;
  };
  latestMessage: ContextMessage;
  translation?: TranslationResult | null;
  recentMessages: ContextMessage[];
  rewriteInput?: string;
  timelineWindowSize?: number;
}) {
  const timezone = process.env.APP_TIMEZONE || "Asia/Tokyo";
  const generationClock = getGenerationClock(timezone);
  const timelineWindowSize = Math.max(10, Math.min(input.timelineWindowSize || 12, 15));

  const allMessages = dedupeMessagesById([...input.recentMessages, input.latestMessage]);
  const ordered = sortMessagesBySentAtAsc(allMessages.filter((item) => !!toMs(item.sentAt)));
  const timelineWindow = ordered.slice(-timelineWindowSize);
  const currentCustomerTurn = buildCurrentCustomerTurn({
    orderedMessages: ordered,
    targetMessageId: input.latestMessage.id,
  });

  const objectiveFacts = deriveObjectiveSalesFacts({
    latestMessage: input.latestMessage,
    recentMessages: ordered,
    customerStage: input.customer.stage,
    currentCustomerTurn: {
      joinedText: currentCustomerTurn.joined_text,
      firstMessageId: currentCustomerTurn.messages[0]?.id || null,
    },
  });

  const keyLongMessageMs = objectiveFacts.key_operator_long_message
    ? new Date(objectiveFacts.key_operator_long_message.sent_at_iso).getTime()
    : null;

  const timelineMessages = buildTimelineMessages({
    messages: timelineWindow,
    keyOperatorLongMessageMs: keyLongMessageMs,
  });

  const latestMessageMs = toMs(input.latestMessage.sentAt) || Date.now();
  const previousMessage =
    [...ordered]
      .filter((item) => item.id !== input.latestMessage.id)
      .sort((a, b) => (toMs(b.sentAt) || 0) - (toMs(a.sentAt) || 0))[0] || null;
  const previousMessageMs = toMs(previousMessage?.sentAt);

  return {
    objective: "Generate two LINE-ready Japanese reply suggestions (A/B) for operator review, grounded in current_customer_turn.",
    timezone,
    assistant_role_sentence:
      "You are a mature, soft, high-context Japanese LINE chat seller who supports one-on-one relationship-driven conversion.",
    business_position: buildBusinessPosition({
      isInitialReceptionPhase: objectiveFacts.is_initial_reception_phase,
      isReplyToFreeReading: objectiveFacts.is_reply_to_free_reading,
      hasPaidOrder: objectiveFacts.has_paid_order,
    }),
    sales_direction: buildSalesDirection({
      isInitialReceptionPhase: objectiveFacts.is_initial_reception_phase,
      isReplyToFreeReading: objectiveFacts.is_reply_to_free_reading,
      hitCtaOption: objectiveFacts.hit_cta_option,
      hasPaidOrder: objectiveFacts.has_paid_order,
    }),
    chat_turn_rhythm: {
      priority: "high",
      rule_order: [
        "Hard facts, pricing/workflow boundaries, and safety boundaries first.",
        "Then chat_turn_rhythm.",
        "Then sales completeness.",
        "Then stage strategy detail.",
      ],
      core_rules: [
        "Reply to current_customer_turn as one LINE turn, not just the last sentence.",
        "Do not compress multi-turn sales steps into one message.",
        "Normally move half-step to one step only.",
        "If customer turn is short, keep reply short and natural.",
      ],
    },
    customer: {
      customer_id: input.customer.id,
      display_name: input.customer.display_name,
      stage: input.customer.stage,
      has_paid_order: objectiveFacts.has_paid_order,
    },
    generation_clock: generationClock,
    latest_customer_message: {
      role: "technical_target_last_message_of_current_turn",
      message_id: input.latestMessage.id,
      sent_at_iso: toIso(input.latestMessage.sentAt),
      japanese_text: input.latestMessage.japaneseText,
      chinese_translation: input.translation?.translation || "",
      minutes_since_previous_message:
        previousMessageMs == null ? null : Math.max(0, Math.round((latestMessageMs - previousMessageMs) / 60000)),
    },
    current_customer_turn: currentCustomerTurn,
    key_operator_long_message: toJapaneseOnlyKeyOperatorLongMessage(objectiveFacts.key_operator_long_message),
    objective_facts: {
      is_reply_to_free_reading: objectiveFacts.is_reply_to_free_reading,
      is_first_valid_reply_after_free_reading: objectiveFacts.is_first_valid_reply_after_free_reading,
      is_first_valid_customer_turn_after_free_reading: objectiveFacts.is_first_valid_customer_turn_after_free_reading,
      hit_cta_option: objectiveFacts.hit_cta_option,
      selected_cta_option: objectiveFacts.selected_cta_option,
      cta_options: objectiveFacts.cta_options,
      has_paid_order: objectiveFacts.has_paid_order,
      has_explicit_objection: objectiveFacts.has_explicit_objection,
      has_explicit_rejection: objectiveFacts.has_explicit_rejection,
      is_initial_reception_phase: objectiveFacts.is_initial_reception_phase,
    },
    timeline: {
      message_window_size: timelineMessages.length,
      messages: timelineMessages,
    },
    sales_brain_playbook: salesBrainPlaybook,
    rewrite_requirement: (input.rewriteInput || "").trim(),
  };
}
