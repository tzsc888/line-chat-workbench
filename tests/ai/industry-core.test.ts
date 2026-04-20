import test from "node:test";
import assert from "node:assert/strict";

import { buildDeliveryContextFromMessages, deriveIndustryStage, getIndustryRulePack } from "../../lib/industry/core";

const customerMessage = {
  id: "m2",
  role: "CUSTOMER" as const,
  type: "TEXT" as const,
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
        japaneseText:
          "もしここから先をもう少し深く視ていくなら、今の佳澄さんにいちばん近いものを、この中から1つだけ送ってくださいね。『金の流れ』『生活の不安』『受け取れなさ』",
        chineseText: "如果想继续深入看，请从这些里选一个发给我。金钱流动、生活不安、无法接收。",
        sentAt: new Date("2026-01-01T10:00:00Z"),
      },
      customerMessage,
    ],
  });

  assert.equal(result.deliveryType, "FREE_READING");
  assert.equal(result.ctaType, "TOPIC_REPLY");
  assert.deepEqual(result.ctaOptions, ["金の流れ", "生活の不安", "受け取れなさ"]);
  assert.match(result.boundaryReminder, /免费交付/);
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
  assert.match(pack.stageGoal, /首单个别深度鉴定/);
  assert.ok(pack.stepRules.length >= 4);
  assert.match(pack.buyerLanguageSignal, /很累|很乱|很痛/);
  assert.match(pack.buyerLanguageProductDirection, /浄化|ヒーリング|波動修正/);
  assert.ok(pack.mustHave.includes("至少一句机制命中句"));
});
