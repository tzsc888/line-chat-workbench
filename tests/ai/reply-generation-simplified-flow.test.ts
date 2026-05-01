import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { __testOnly as generationTestOnly } from "../../lib/ai/reply-generation-service";
import { __testOnly as contextTestOnly, buildMainBrainGenerationContext } from "../../lib/ai/context-builder";

test("active runReplyGeneration path should not call safe fallback or final repair", () => {
  const file = fs.readFileSync(path.resolve(process.cwd(), "lib/ai/reply-generation-service.ts"), "utf8");
  const start = file.indexOf("export async function runReplyGeneration");
  const end = file.indexOf("\n}", start);
  const body = file.slice(start, Math.max(start, end + 2));
  assert.equal(body.includes("buildBareOptionSafeFallback("), false);
  assert.equal(body.includes("buildFinalRepairInstruction("), false);
  assert.equal(body.includes("user: JSON.stringify(modelContext, null, 2)"), true);
  assert.equal(body.includes("user: JSON.stringify(context, null, 2)"), false);
});

test("hardQualityErrors should fail on json-meta/empty/too-long/internal-name/hard-sales words", () => {
  const context = {
    customer: {
      self_reported_name: "\u3082\u3082",
      internal_display_name: "26.4.28\u53e4\u8cc0\u6843\u5b50",
    },
  };
  const tooLong = "a".repeat(520);
  const hardSales = "\u8cb7\u3044\u307e\u3059\u304b\uff1f";
  const errors = generationTestOnly.buildHardQualityErrors(
    context,
    `reply_a_ja: 26.4.28 ${hardSales} ${tooLong}`,
    "",
  );
  assert.equal(errors.includes("empty_reply"), true);
  assert.equal(errors.includes("contains_internal_metadata_style_text"), true);
  assert.equal(errors.includes("reply_too_long"), true);
  assert.equal(errors.includes("contains_internal_display_name_or_date"), true);
  assert.equal(errors.includes("contains_hard_sales_words"), true);
});

test("hardQualityErrors should fail on chinese output", () => {
  const context = { customer: { self_reported_name: "\u3082\u3082", internal_display_name: "26.4.28\u53e4\u8cc0\u6843\u5b50" } };
  const errors = generationTestOnly.buildHardQualityErrors(context, "\u4e2d\u6587\u56de\u590d", "\u8c22\u8c22");
  assert.equal(errors.includes("contains_chinese"), true);
});

test("containsChinese / hardQualityErrors should not false-positive normal japanese kanji", () => {
  const context = { customer: { self_reported_name: "もも", internal_display_name: "26.4.28古賀桃子" } };
  const errors = generationTestOnly.buildHardQualityErrors(
    context,
    "個別鑑定で詳しく見ていきます",
    "無料鑑定の範囲です。お子さんとの生活を守る流れです",
  );
  assert.equal(errors.includes("contains_chinese"), false);
});

test("hardQualityErrors should not fail for non-hard-style short replies", () => {
  const context = { customer: { self_reported_name: "\u3082\u3082", internal_display_name: "26.4.28\u53e4\u8cc0\u6843\u5b50" } };
  const errors = generationTestOnly.buildHardQualityErrors(
    context,
    "\u300e\u304a\u91d1\u306e\u6d41\u308c\u300f\u3067\u3059\u306d\u3002",
    "\u3053\u3053\u304b\u3089\u500b\u5225\u306b\u898b\u3066\u3044\u304d\u307e\u3057\u3087\u3046\u3002",
  );
  assert.equal(errors.length, 0);
});

test("extractSelfReportedCustomerName should parse circled-number intake format", () => {
  const messages = [
    {
      id: "c1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "\u2460\u3082\u3082 \u2461\u0031\u0039\u0038\u0039\u002e\u0033\u002e\u0039 \u2462\u73fe\u72b6 \u2463\u5b50\u4f9b\u9054",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
  ];
  const name = contextTestOnly.extractSelfReportedCustomerName(messages);
  assert.equal(name, "\u3082\u3082");
});

test("simple stage should classify post_free_option_reply", () => {
  const stage = contextTestOnly.deriveSimpleStage({
    objectiveFacts: {
      is_reply_to_free_reading: true,
      hit_cta_option: true,
      selected_cta_option: "\u76f8\u624b\u306e\u672c\u97f3",
      has_paid_order: false,
      has_explicit_objection: false,
      has_explicit_rejection: false,
      is_initial_reception_phase: false,
    },
    currentCustomerTurnJoinedText: "\u76f8\u624b\u3068\u306e\u672c\u97f3",
  });
  assert.equal(stage, "post_free_option_reply");
});

test("momo context should derive post_free_option_reply with self-reported name and bridge fields", () => {
  const context = buildMainBrainGenerationContext({
    customer: { id: "c-momo", stage: "NEW", display_name: "26.4.28古賀桃子" },
    latestMessage: {
      id: "m3",
      role: "CUSTOMER",
      type: "TEXT",
      source: "LINE",
      japaneseText: "お金の流れ",
      chineseText: null,
      sentAt: new Date("2026-04-30T10:11:00+09:00"),
    },
    translation: { translation: "" },
    recentMessages: [
      {
        id: "m1",
        role: "CUSTOMER",
        type: "TEXT",
        source: "LINE",
        japaneseText: "①もも ②1989.3.9 ③現状をどおすればいいか(金銭面も含めて) ④子供達と自分が笑ってすごせる未来",
        chineseText: null,
        sentAt: new Date("2026-04-30T10:00:00+09:00"),
      },
      {
        id: "m2",
        role: "OPERATOR",
        type: "TEXT",
        source: "MANUAL",
        japaneseText: "この中から1つ選んで送ってください\n『お金の流れ』\n『生活の安心』\n『子供達との未来』",
        chineseText: null,
        sentAt: new Date("2026-04-30T10:10:00+09:00"),
      },
      {
        id: "m3",
        role: "CUSTOMER",
        type: "TEXT",
        source: "LINE",
        japaneseText: "お金の流れ",
        chineseText: null,
        sentAt: new Date("2026-04-30T10:11:00+09:00"),
      },
    ],
    rewriteInput: "",
    timelineWindowSize: 12,
  });
  assert.equal(context.simple_context.customer.self_reported_name, "もも");
  assert.equal(context.simple_context.stage, "post_free_option_reply");
  assert.equal(context.simple_context.conversation.selected_option, "お金の流れ");
  assert.equal(
    context.simple_context.conversation.original_consultation.some((v: string) => /金銭面|子供達/.test(v)),
    true,
  );
  assert.equal(
    context.simple_context.conversation.pain_anchors.some((v: string) => /金銭面|子供達/.test(v)),
    true,
  );
  assert.equal(context.simple_context.sales_goal, "初回有料鑑定への低圧橋渡し");
});

test("romance fuzzy option should classify post_free_option_reply", () => {
  const context = buildMainBrainGenerationContext({
    customer: { id: "c-romance", stage: "NEW", display_name: "26.4.28古賀桃子" },
    latestMessage: {
      id: "r3",
      role: "CUSTOMER",
      type: "TEXT",
      source: "LINE",
      japaneseText: "相手との本音",
      chineseText: null,
      sentAt: new Date("2026-04-30T11:11:00+09:00"),
    },
    translation: { translation: "" },
    recentMessages: [
      {
        id: "r1",
        role: "CUSTOMER",
        type: "TEXT",
        source: "LINE",
        japaneseText: "今話してる子が俺の事どう思ってるか知りたい\nその子と付き合えるか知りたい",
        chineseText: null,
        sentAt: new Date("2026-04-30T11:00:00+09:00"),
      },
      {
        id: "r2",
        role: "OPERATOR",
        type: "TEXT",
        source: "MANUAL",
        japaneseText: "この中から1つ選んで送ってください\n『相手の本音』\n『距離の縮め方』\n『付き合える流れ』",
        chineseText: null,
        sentAt: new Date("2026-04-30T11:10:00+09:00"),
      },
      {
        id: "r3",
        role: "CUSTOMER",
        type: "TEXT",
        source: "LINE",
        japaneseText: "相手との本音",
        chineseText: null,
        sentAt: new Date("2026-04-30T11:11:00+09:00"),
      },
    ],
    rewriteInput: "",
    timelineWindowSize: 12,
  });
  assert.equal(context.simple_context.stage, "post_free_option_reply");
  assert.equal(context.simple_context.conversation.selected_option, "相手の本音");
  assert.equal(context.simple_context.stage === "detail_request_after_free", false);
});

test("detail request should classify detail_request_after_free", () => {
  const stage = contextTestOnly.deriveSimpleStage({
    objectiveFacts: {
      is_reply_to_free_reading: true,
      hit_cta_option: false,
      selected_cta_option: null,
      has_paid_order: false,
      has_explicit_objection: false,
      has_explicit_rejection: false,
      is_initial_reception_phase: false,
    },
    currentCustomerTurnJoinedText: "詳しく知りたいです",
  });
  assert.equal(stage, "detail_request_after_free");
});

test("model payload context should only include simple/minimal fields", () => {
  const payload = generationTestOnly.buildModelContext({
    customer: {
      self_reported_name: "もも",
      internal_display_name: "26.4.28古賀桃子",
      stableChinese: "x",
      advancingChinese: "y",
    },
    simple_context: {
      customer: {
        self_reported_name: "もも",
        do_not_use_internal_display_name_in_reply: true,
      },
      stage: "post_free_option_reply",
      current_turn: { messages: ["お金の流れ"], time_gap_hint: "short" },
      conversation: {
        original_consultation: ["現状をどおすればいいか(金銭面も含めて)", "子供達と自分が笑ってすごせる未来"],
        last_operator_message_type: "free_reading",
        selected_option: "お金の流れ",
        pain_anchors: ["金銭面", "子供達"],
        bridge_meaning: "顧客はお金の流れを通じて不安を深く確認したい状態。",
      },
      sales_goal: "初回有料鑑定への低圧橋渡し",
    },
    stableChinese: "x",
    advancingChinese: "y",
    debugMeta: { foo: "bar" },
  });
  assert.equal("stableChinese" in payload, false);
  assert.equal("advancingChinese" in payload, false);
  assert.equal("debugMeta" in payload, false);
  assert.equal(payload.customer.self_reported_name, "もも");
  assert.equal("internal_display_name" in payload.customer, false);
});
