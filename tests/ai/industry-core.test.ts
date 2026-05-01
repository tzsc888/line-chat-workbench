import test from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryContextFromMessages, deriveIndustryStage, getIndustryRulePack } from "../../lib/industry/core";
import { deriveObjectiveSalesFacts } from "../../lib/industry/core";

const customerMessage = {
  id: "m2",
  role: "CUSTOMER" as const,
  type: "TEXT" as const,
  source: "LINE" as const,
  japaneseText: "生活の不安がやっぱり気になります",
  chineseText: "我还是很在意生活的不安",
  sentAt: new Date("2026-01-01T10:01:00Z"),
};

test("buildDeliveryContextFromMessages extracts recent operator delivery summary and CTA options", () => {
  const result = buildDeliveryContextFromMessages({
    latestMessage: customerMessage,
    customerStage: "NEGOTIATING",
    recentMessages: [
      {
        id: "m1",
        role: "OPERATOR",
        type: "TEXT",
        source: "MANUAL",
        japaneseText:
          "もしここから先をもう少し深く見ていくなら、今のあなたにいちばん近いものを、この中から1つだけ送ってください。「金の流れ」「生活の不安」「受け取れなさ」",
        chineseText: "如果想继续深入看，请从这里选一个发给我。",
        sentAt: new Date("2026-01-01T10:00:00Z"),
      },
      customerMessage,
    ],
  });

  assert.equal(result.deliveryType, "FREE_READING");
  assert.equal(result.ctaType, "TOPIC_REPLY");
  assert.ok(result.ctaOptions.length >= 1);
  assert.match(result.boundaryReminder, /free reading|免费/i);
});

test("deriveIndustryStage returns intake when no delivery context exists and retention after purchase", () => {
  const intake = deriveIndustryStage({
    customerStage: "NEW",
    latestMessage: customerMessage,
    recentMessages: [customerMessage],
    deliveryContext: {
      deliveryType: null,
      summary: "",
      coreTheme: null,
      ctaType: null,
      ctaOptions: [],
      alreadySaid: [],
      boundaryReminder: "",
    },
  });
  assert.equal(intake, "INTAKE_RECEPTION");

  const retention = deriveIndustryStage({
    customerStage: "PAID",
    latestMessage: customerMessage,
    recentMessages: [customerMessage],
    deliveryContext: {
      deliveryType: "FIRST_ORDER_READING",
      summary: "",
      coreTheme: null,
      ctaType: "NONE",
      ctaOptions: [],
      alreadySaid: [],
      boundaryReminder: "",
    },
  });
  assert.equal(retention, "POST_FIRST_ORDER_RETENTION");
});

test("getIndustryRulePack exposes compact stage and buyer-language guidance", () => {
  const pack = getIndustryRulePack("POST_FREE_READING_CONVERSION", "STATE");
  assert.equal(typeof pack.stageGoal, "string");
  assert.ok(pack.stepRules.length >= 3);
  assert.equal(typeof pack.buyerLanguageSignal, "string");
  assert.equal(typeof pack.buyerLanguageProductDirection, "string");
});

test("deriveObjectiveSalesFacts should not treat short operator text as free-reading long message", () => {
  const messages = [
    {
      id: "o1",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: "はい、見ていきますね",
      chineseText: null,
      sentAt: new Date("2026-01-01T10:00:00Z"),
    },
    {
      ...customerMessage,
      id: "c2",
      japaneseText: "相手との本音",
      sentAt: new Date("2026-01-01T10:01:00Z"),
    },
  ];

  const facts = deriveObjectiveSalesFacts({
    latestMessage: messages[1],
    recentMessages: messages,
    customerStage: "NEW",
    currentCustomerTurn: {
      joinedText: "相手との本音",
      firstMessageId: "c2",
    },
  });

  assert.equal(facts.is_reply_to_free_reading, false);
  assert.equal(facts.key_operator_long_message, null);
});

test("deriveObjectiveSalesFacts should fuzzy-match close CTA option wording", () => {
  const longMessage = [
    "ここから先を見ていくために、この中から1つだけ送ってください",
    "『相手の本音』",
    "『距離の縮め方』",
    "『付き合える流れ』",
  ].join("\n");
  const messages = [
    {
      id: "o1",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: longMessage,
      chineseText: null,
      sentAt: new Date("2026-01-01T10:00:00Z"),
    },
    {
      ...customerMessage,
      id: "c3",
      japaneseText: "相手との本音",
      sentAt: new Date("2026-01-01T10:01:00Z"),
    },
  ];

  const facts = deriveObjectiveSalesFacts({
    latestMessage: messages[1],
    recentMessages: messages,
    customerStage: "NEW",
    currentCustomerTurn: {
      joinedText: "相手との本音",
      firstMessageId: "c3",
    },
  });

  assert.equal(facts.hit_cta_option, true);
  assert.equal(facts.selected_cta_option, "相手の本音");
});
