import type { BuyerLanguage, ContextMessage, DeliveryContext, IndustryStage } from "../ai/ai-types";
import { buyerLanguageGuide } from "./buyer-language";
import { postFreeConversionRule } from "./conversion";
import { intakeReceptionRule } from "./reception";
import { postFirstOrderRetentionRule } from "./retention";

const MAX_SUMMARY = 260;

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function shorten(text: string, max = MAX_SUMMARY) {
  const value = normalize(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function guessCoreTheme(text: string) {
  const raw = normalize(text);
  if (!raw) return null;
  const themePatterns: Array<[RegExp, string]> = [
    [/(生活の不安|金の流れ|お金|金運|生活|受け取れなさ)/, "生活・金钱不安"],
    [/(相手の気持ち|彼の気持ち|彼どう|関係|ご縁|縁|復縁|恋愛)/, "关系/对方想法"],
    [/(どう動く|どうしたら|行動|次の一歩|今動くべき|主導)/, "行动判断"],
    [/(時期|タイミング|流れ|いつ|近いうち)/, "时期/走势"],
    [/(浄化|ヒーリング|波動|エネルギー|守護|天使)/, "净化/灵性状态"],
  ];
  for (const [pattern, label] of themePatterns) {
    if (pattern.test(raw)) return label;
  }
  const quoted = raw.match(/[「『](.{1,18})[」』]/);
  return quoted?.[1] || null;
}

function extractCtaOptions(text: string) {
  const matches = [...text.matchAll(/[「『]([^「」『』\n]{1,18})[」』]/g)].map((match) => normalize(match[1]));
  return Array.from(new Set(matches)).filter(Boolean).slice(0, 4);
}

function inferCtaType(text: string, ctaOptions: string[], hasPurchased: boolean): DeliveryContext["ctaType"] {
  if (ctaOptions.length > 0) return "TOPIC_REPLY";
  if (/個別希望|詳しく希望|深く視てほしい/.test(text)) return "INDIVIDUAL_REQUEST";
  return hasPurchased ? "NONE" : "NONE";
}

export function buildDeliveryContextFromMessages(input: {
  latestMessage: ContextMessage;
  recentMessages: ContextMessage[];
  customerStage: string;
}): DeliveryContext {
  const { latestMessage, recentMessages, customerStage } = input;
  const hasPurchased = customerStage === "PAID" || customerStage === "AFTER_SALES";
  const ordered = [...recentMessages].sort((a, b) => new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime());
  const latestIndex = ordered.findIndex((message) => message.id === latestMessage.id);
  const searchPool = latestIndex >= 0 ? ordered.slice(0, latestIndex).reverse() : [...ordered].reverse();
  const priorOperatorMessages = searchPool.filter((message) => message.role === "OPERATOR" && message.type === "TEXT" && normalize(message.japaneseText));
  const readingLike = priorOperatorMessages.find((message) => normalize(message.japaneseText).length >= 80) || priorOperatorMessages[0] || null;

  if (!readingLike) {
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

  const rawText = readingLike.japaneseText || "";
  const ctaOptions = extractCtaOptions(rawText);
  const summary = shorten(rawText);
  const coreTheme = guessCoreTheme(rawText);
  const boundaryReminder = hasPurchased
    ? "前一次正式交付已经完成，本轮重点是沿着交付后的变化、节点或下一步行动继续承接，不重复整篇鉴定内容。"
    : "前一次免费交付已经给出整体趋势，本轮承接不能继续免费讲深，真正的根、切れ目、反复模式与时机应引导到个别深度鉴定。";

  return {
    deliveryType: hasPurchased ? "FIRST_ORDER_READING" : "FREE_READING",
    summary,
    coreTheme,
    ctaType: inferCtaType(rawText, ctaOptions, hasPurchased),
    ctaOptions,
    alreadySaid: [shorten(rawText, 140)],
    boundaryReminder,
  };
}

export function deriveIndustryStage(input: {
  customerStage: string;
  recentMessages: ContextMessage[];
  latestMessage: ContextMessage;
  deliveryContext: DeliveryContext;
}): IndustryStage {
  const { customerStage, deliveryContext } = input;
  if (customerStage === "PAID" || customerStage === "AFTER_SALES") {
    return "POST_FIRST_ORDER_RETENTION";
  }
  if (deliveryContext.deliveryType === "FREE_READING") {
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
        routeBias: ["JUST_HOLD", "LIGHT_HOLD"],
      };
    case "POST_FREE_READING_CONVERSION":
      return {
        goal: postFreeConversionRule.goal,
        allowedActions: [...postFreeConversionRule.allowedActions],
        forbiddenActions: [...postFreeConversionRule.forbiddenActions],
        styleNotes: [
          "按三步承接推进",
          "先顺着她，再半步命中，再立边界",
          "仍然要像LINE聊天，不像正式文",
        ],
        routeBias: ["LIGHT_HOLD", "STEADY_PUSH", "OBJECTION_HANDLING"],
      };
    case "POST_FIRST_ORDER_RETENTION":
      return {
        goal: postFirstOrderRetentionRule.goal,
        allowedActions: [...postFirstOrderRetentionRule.allowedActions],
        forbiddenActions: [...postFirstOrderRetentionRule.forbiddenActions],
        styleNotes: [
          ...postFirstOrderRetentionRule.cadence,
          "低压但有经营感",
        ],
        routeBias: ["POST_PURCHASE_CARE", "LIGHT_HOLD"],
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
    mustHave:
      stage === "POST_FREE_READING_CONVERSION" ? [...postFreeConversionRule.mustHave] : [],
  };
}
