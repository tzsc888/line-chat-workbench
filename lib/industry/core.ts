import type { BuyerLanguage, ContextMessage, DeliveryContext, IndustryStage } from "../ai/ai-types";
import { buyerLanguageGuide } from "./buyer-language";
import { postFreeConversionRule } from "./conversion";
import { intakeReceptionRule } from "./reception";
import { postFirstOrderRetentionRule } from "./retention";

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function toMs(value: Date | string | undefined) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function extractQuotedOptions(text: string) {
  const result = [...text.matchAll(/[「『“\"]([^「」『』“”\"\n]{1,24})[」』”\"]/g)]
    .map((match) => normalize(match[1]))
    .filter(Boolean);
  return Array.from(new Set(result));
}

function extractCtaOptions(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const ctaCueIndex = lines.findLastIndex((line) =>
    /(この中から|1つだけ|ひとつだけ|送ってください|選んでください|近いもの)/.test(line),
  );

  if (ctaCueIndex >= 0) {
    const ctaTailLines: string[] = [];
    for (const line of lines.slice(ctaCueIndex + 1, Math.min(lines.length, ctaCueIndex + 30))) {
      if (/^(P\.?S\.?|追伸)/i.test(line)) break;
      ctaTailLines.push(line);
    }
    const tailBlock = ctaTailLines.join("\n");
    const tailOptions = extractQuotedOptions(tailBlock).slice(0, 8);
    if (tailOptions.length >= 2) {
      return tailOptions;
    }
  }

  const allQuoted = extractQuotedOptions(text);
  return allQuoted.slice(-8);
}

function findLatestOperatorLongText(messages: ContextMessage[], latestMessageId: string) {
  const ordered = [...messages].sort((a, b) => (toMs(a.sentAt) || 0) - (toMs(b.sentAt) || 0));
  const latestIndex = ordered.findIndex((item) => item.id === latestMessageId);
  const pool = latestIndex >= 0 ? ordered.slice(0, latestIndex).reverse() : ordered.reverse();
  return (
    pool.find((item) => item.role === "OPERATOR" && item.type === "TEXT" && normalize(item.japaneseText).length >= 80) ||
    pool.find((item) => item.role === "OPERATOR" && item.type === "TEXT" && normalize(item.japaneseText).length > 0) ||
    null
  );
}

function hasOperatorTextBeforeLatest(messages: ContextMessage[], latestMessageId: string) {
  const ordered = [...messages].sort((a, b) => (toMs(a.sentAt) || 0) - (toMs(b.sentAt) || 0));
  const latestIndex = ordered.findIndex((item) => item.id === latestMessageId);
  const pool = latestIndex >= 0 ? ordered.slice(0, latestIndex) : ordered;
  return pool.some((item) => item.role === "OPERATOR" && item.type === "TEXT" && normalize(item.japaneseText).length > 0);
}

function detectExplicitObjection(text: string) {
  const value = normalize(text);
  if (!value) return false;
  return /(高い|高額|予算|迷う|不安|疑問|信用|本当|効果|意味ある|どうして)/i.test(value);
}

function detectExplicitRejection(text: string) {
  const value = normalize(text);
  if (!value) return false;
  return /(いらない|不要|結構です|やめます|やめとく|しない|無理|興味ない|必要ない)/i.test(value);
}

export function buildDeliveryContextFromMessages(input: {
  latestMessage: ContextMessage;
  recentMessages: ContextMessage[];
  customerStage: string;
}): DeliveryContext {
  const hasPurchased = input.customerStage === "PAID" || input.customerStage === "AFTER_SALES";
  const longMessage = findLatestOperatorLongText(input.recentMessages, input.latestMessage.id);

  if (!longMessage) {
    return {
      deliveryType: null,
      summary: "",
      coreTheme: null,
      ctaType: null,
      ctaOptions: [],
      alreadySaid: [],
      boundaryReminder: "",
    };
  }

  const fullText = longMessage.japaneseText || "";
  const ctaOptions = extractCtaOptions(fullText);

  return {
    deliveryType: hasPurchased ? "FIRST_ORDER_READING" : "FREE_READING",
    summary: fullText,
    coreTheme: ctaOptions[0] || null,
    ctaType: ctaOptions.length > 0 ? "TOPIC_REPLY" : "NONE",
    ctaOptions,
    alreadySaid: [fullText],
    boundaryReminder: hasPurchased
      ? "Customer already paid previously. Focus on continuation and next action, avoid restarting from cold pitch."
      : "There was already a free reading. Do not repeat a second full free reading.",
  };
}

export function deriveIndustryStage(input: {
  customerStage: string;
  recentMessages: ContextMessage[];
  latestMessage: ContextMessage;
  deliveryContext: DeliveryContext;
}): IndustryStage {
  if (input.customerStage === "PAID" || input.customerStage === "AFTER_SALES") {
    return "POST_FIRST_ORDER_RETENTION";
  }
  if (input.deliveryContext.deliveryType === "FREE_READING") {
    return "POST_FREE_READING_CONVERSION";
  }
  return "INTAKE_RECEPTION";
}

export function getIndustryStageSummary(stage: IndustryStage) {
  switch (stage) {
    case "INTAKE_RECEPTION":
      return {
        goal: intakeReceptionRule.goal,
        allowedActions: [...intakeReceptionRule.allowedActions],
        forbiddenActions: [...intakeReceptionRule.forbiddenActions],
        styleNotes: [...intakeReceptionRule.styleNotes],
        routeBias: ["LIGHT_HOLD"],
      };
    case "POST_FREE_READING_CONVERSION":
      return {
        goal: postFreeConversionRule.goal,
        allowedActions: [...postFreeConversionRule.allowedActions],
        forbiddenActions: [...postFreeConversionRule.forbiddenActions],
        styleNotes: [...postFreeConversionRule.ctaGuidance],
        routeBias: ["STEADY_PUSH"],
      };
    case "POST_FIRST_ORDER_RETENTION":
      return {
        goal: postFirstOrderRetentionRule.goal,
        allowedActions: [...postFirstOrderRetentionRule.allowedActions],
        forbiddenActions: [...postFirstOrderRetentionRule.forbiddenActions],
        styleNotes: [...postFirstOrderRetentionRule.cadence],
        routeBias: ["POST_PURCHASE_CARE"],
      };
  }
}

export function getIndustryRulePack(stage: IndustryStage, buyerLanguage: BuyerLanguage = "UNKNOWN") {
  const stageSummary = getIndustryStageSummary(stage);
  const buyer = buyerLanguageGuide[buyerLanguage];
  const stepRules =
    stage === "INTAKE_RECEPTION"
      ? intakeReceptionRule.structure
      : stage === "POST_FREE_READING_CONVERSION"
        ? postFreeConversionRule.formula
        : postFirstOrderRetentionRule.cadence;

  return {
    stageGoal: stageSummary.goal,
    stageDos: [...stageSummary.allowedActions],
    stageDonts: [...stageSummary.forbiddenActions],
    stageStyle: [...stageSummary.styleNotes],
    stepRules,
    buyerLanguageSignal: buyer.signal,
    buyerLanguageProductDirection: buyer.productDirection,
    mustHave: stage === "POST_FREE_READING_CONVERSION" ? [...postFreeConversionRule.mustHave] : [],
  };
}

export function deriveObjectiveSalesFacts(input: {
  latestMessage: ContextMessage;
  recentMessages: ContextMessage[];
  customerStage: string;
  currentCustomerTurn?: {
    joinedText: string;
    firstMessageId: string | null;
  };
}) {
  const hasPaidOrder = input.customerStage === "PAID" || input.customerStage === "AFTER_SALES";
  const keyOperatorLongMessage = findLatestOperatorLongText(input.recentMessages, input.latestMessage.id);
  const ctaOptions = keyOperatorLongMessage ? extractCtaOptions(keyOperatorLongMessage.japaneseText || "") : [];
  const turnText = String(input.currentCustomerTurn?.joinedText || input.latestMessage.japaneseText || "");
  const selectedCtaOption = ctaOptions.find((option) => turnText.includes(option)) || null;
  const hasOperatorBeforeLatest = hasOperatorTextBeforeLatest(input.recentMessages, input.latestMessage.id);

  const latestMs = toMs(input.latestMessage.sentAt) || Date.now();
  const keyLongMs = toMs(keyOperatorLongMessage?.sentAt);

  const isReplyToFreeReading = !hasPaidOrder && !!keyOperatorLongMessage;
  const customerTextsAfterKey = keyOperatorLongMessage
    ? [...input.recentMessages]
        .filter((item) => item.role === "CUSTOMER" && item.type === "TEXT" && (toMs(item.sentAt) || 0) > (keyLongMs || 0))
        .sort((a, b) => (toMs(a.sentAt) || 0) - (toMs(b.sentAt) || 0))
    : [];
  const firstValidCustomerTurnAfterFreeReading =
    isReplyToFreeReading &&
    customerTextsAfterKey.length > 0 &&
    !!input.currentCustomerTurn?.firstMessageId &&
    customerTextsAfterKey[0].id === input.currentCustomerTurn.firstMessageId;
  const isFirstValidReplyAfterFreeReading =
    firstValidCustomerTurnAfterFreeReading ||
    (isReplyToFreeReading &&
      customerTextsAfterKey.length > 0 &&
      customerTextsAfterKey[0].id === input.latestMessage.id);

  return {
    is_reply_to_free_reading: isReplyToFreeReading,
    hit_cta_option: !!selectedCtaOption,
    selected_cta_option: selectedCtaOption,
    cta_options: ctaOptions,
    has_paid_order: hasPaidOrder,
    has_explicit_objection: detectExplicitObjection(turnText),
    has_explicit_rejection: detectExplicitRejection(turnText),
    is_first_valid_reply_after_free_reading: isFirstValidReplyAfterFreeReading,
    is_first_valid_customer_turn_after_free_reading: firstValidCustomerTurnAfterFreeReading,
    is_initial_reception_phase: !hasPaidOrder && !hasOperatorBeforeLatest,
    key_operator_long_message: keyOperatorLongMessage
      ? {
          message_id: keyOperatorLongMessage.id,
          role: keyOperatorLongMessage.role,
          type: keyOperatorLongMessage.type,
          source: keyOperatorLongMessage.source,
          sent_at_iso: new Date(toMs(keyOperatorLongMessage.sentAt) || Date.now()).toISOString(),
          japanese_text: keyOperatorLongMessage.japaneseText,
          chinese_text: keyOperatorLongMessage.chineseText || "",
          minutes_since_key_message: keyLongMs == null ? null : Math.max(0, Math.round((latestMs - keyLongMs) / 60000)),
        }
      : null,
  };
}

