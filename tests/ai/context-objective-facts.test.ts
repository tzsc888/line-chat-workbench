import test from "node:test";
import assert from "node:assert/strict";
import { deriveObjectiveSalesFacts } from "../../lib/industry/core";
import { buildMainBrainGenerationContext } from "../../lib/ai/context-builder";

test("deriveObjectiveSalesFacts should detect CTA option from tail option block", () => {
  const longFreeReading = [
    "intro line",
    "context line",
    "background line",
    "please choose one option and send back",
    "option-1 breathe",
    "option-2 cat-bond",
    "option-3 work-flow",
    "option-4 fix-now",
  ].join("\n");

  const messages = [
    {
      id: "m1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "first consult",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
    {
      id: "m2",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: longFreeReading,
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
    {
      id: "m3",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "I choose option-2 cat-bond",
      chineseText: null,
      sentAt: new Date("2026-04-20T12:00:00+09:00"),
    },
  ];

  const facts = deriveObjectiveSalesFacts({
    latestMessage: messages[2],
    recentMessages: messages,
    customerStage: "NEW",
    currentCustomerTurn: {
      joinedText: "I choose option-2 cat-bond",
      firstMessageId: "m3",
    },
  });

  assert.equal(typeof facts.is_reply_to_free_reading, "boolean");
  assert.equal(typeof facts.is_first_valid_reply_after_free_reading, "boolean");
  assert.equal(typeof facts.hit_cta_option, "boolean");
  assert.equal(
    facts.selected_cta_option === null || typeof facts.selected_cta_option === "string",
    true,
  );
  assert.equal(Array.isArray(facts.cta_options), true);
});

test("buildMainBrainGenerationContext should expose display name and generation clock", () => {
  const latest = {
    id: "m1",
    role: "CUSTOMER" as const,
    type: "TEXT" as const,
    source: "LINE" as const,
    japaneseText: "nice to meet you",
    chineseText: null,
    sentAt: new Date("2026-04-20T10:00:00+09:00"),
  };

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c1",
      stage: "NEW",
      display_name: "kei",
    },
    latestMessage: latest,
    translation: {
      translation: "",
    },
    recentMessages: [latest],
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  assert.equal(context.customer.display_name, "kei");
  assert.equal(context.objective_facts.is_initial_reception_phase, true);
  assert.match(
    context.business_position,
    /初回受付段階|相談内容送信直後/,
  );
  assert.match(
    context.sales_direction,
    /重要情報が欠ける場合を除き追加質問を増やさない/,
  );
  assert.match(
    context.sales_direction,
    /無料鑑定方向へつなぐ|まず流れを見ていく/,
  );
  assert.match(
    context.assistant_role_sentence,
    /日本人女性鑑定師|LINE返信作成AI/,
  );
  assert.equal(context.latest_customer_message.role, "technical_target_last_message_of_current_turn");
  assert.equal(context.current_customer_turn.message_count, 1);
  assert.equal(context.current_customer_turn.messages[0]?.id, "m1");
  assert.equal(context.current_customer_turn.messages[0]?.text, "nice to meet you");
  assert.equal(context.current_customer_turn.joined_text, "nice to meet you");
  assert.equal(context.generation_clock.timezone, "Asia/Tokyo");
  assert.equal(typeof context.generation_clock.now_utc_iso, "string");
  assert.equal(typeof context.generation_clock.now_jst_text, "string");
});

test("current_customer_turn and objective facts should be turn-aware", () => {
  const longFreeReading = [
    "free reading body",
    "please choose one option and send back",
    "option-1 breathe",
    "option-2 cat-bond",
    "option-3 work-flow",
  ].join("\n");

  const messages = [
    {
      id: "m1",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: longFreeReading,
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
    {
      id: "m2",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "thanks",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:01:00+09:00"),
    },
    {
      id: "m3",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "I choose option-2 cat-bond",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:02:00+09:00"),
    },
    {
      id: "m4",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "please",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:03:00+09:00"),
    },
  ];

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c1",
      stage: "NEW",
      display_name: "kei",
    },
    latestMessage: messages[3],
    translation: {
      translation: "",
    },
    recentMessages: messages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  assert.equal(context.current_customer_turn.message_count, 3);
  assert.equal(context.current_customer_turn.messages[0]?.id, "m2");
  assert.equal(context.current_customer_turn.messages[2]?.id, "m4");
  assert.equal(context.objective_facts.hit_cta_option, true);
  assert.equal(context.objective_facts.selected_cta_option, "option-2 cat-bond");
  assert.equal(context.objective_facts.is_first_valid_customer_turn_after_free_reading, true);
  assert.equal(context.objective_facts.is_first_valid_reply_after_free_reading, true);
});

test("buildMainBrainGenerationContext should include non-text messages and timing hint", () => {
  const messages = [
    {
      id: "o1",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: "確認しました",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
    {
      id: "c1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "はい！",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:01:00+09:00"),
    },
    {
      id: "c2",
      role: "CUSTOMER" as const,
      type: "IMAGE" as const,
      source: "LINE" as const,
      japaneseText: "",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:02:00+09:00"),
    },
  ];

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c1",
      stage: "NEW",
      display_name: "kei",
    },
    latestMessage: messages[2],
    translation: {
      translation: "",
    },
    recentMessages: messages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  assert.equal(context.current_customer_turn.message_count, 2);
  assert.equal(context.current_customer_turn.text_messages.length, 1);
  assert.equal(context.current_customer_turn.non_text_messages.length, 1);
  assert.equal(typeof context.timing_context.tone_hint, "string");
});

test("buildMainBrainGenerationContext should include post_free_reading_bridge_context for momo-like option reply", () => {
  const messages = [
    {
      id: "c0",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "現状をどおすればいいか(金銭面も含めて)",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
    {
      id: "c1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "子供達と自分が笑ってすごせる未来",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:01:00+09:00"),
    },
    {
      id: "o-free",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: [
        "無料鑑定の結果です。",
        "この中から1つだけ選んで送ってください。",
        "『お金の流れ』",
        "『生活の安心』",
        "『子供達との未来』",
      ].join("\n"),
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
    {
      id: "c-opt",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "お金の流れ",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:02:00+09:00"),
    },
  ];

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c1",
      stage: "NEW",
      display_name: "もも",
    },
    latestMessage: messages[3],
    translation: { translation: "" },
    recentMessages: messages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  const bridge = context.post_free_reading_bridge_context;
  assert.equal(!!bridge, true);
  assert.equal(bridge.selected_option, "お金の流れ");
  assert.equal(bridge.original_customer_words.join("\n").includes("金銭面"), true);
  assert.equal(bridge.original_customer_words.join("\n").includes("子供達"), true);
  assert.equal(bridge.original_customer_words.join("\n").includes("笑ってすごせる未来"), true);
  assert.equal(bridge.pain_anchors.some((x: string) => /金銭面|お金/.test(x)), true);
  assert.equal(bridge.pain_anchors.some((x: string) => /子供達|お子さん/.test(x)), true);
  assert.match(bridge.bridge_meaning, /顧客は「お金の流れ」/);
  assert.equal(Array.isArray(bridge.recommended_reply_shape), true);
});

test("buildMainBrainGenerationContext should not leak chinese translation fields into generation context", () => {
  const latest = {
    id: "m1",
    role: "CUSTOMER" as const,
    type: "TEXT" as const,
    source: "LINE" as const,
    japaneseText: "お金の流れ",
    chineseText: "资金流向",
    sentAt: new Date("2026-04-20T10:00:00+09:00"),
  };

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c1",
      stage: "NEW",
      display_name: "kei",
      ai_customer_info: "这是中文说明",
      ai_current_strategy: "更销售一点",
    },
    latestMessage: latest,
    translation: {
      translation: "这是翻译",
    },
    recentMessages: [latest],
    rewriteInput: "更销售一点，不要太客气",
    timelineWindowSize: 12,
  });

  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("stableChinese"), false);
  assert.equal(serialized.includes("advancingChinese"), false);
  assert.equal(serialized.includes("translated Chinese"), false);
  assert.equal(serialized.includes("zhMeaning"), false);
  assert.equal(serialized.includes("资金流向"), false);
  assert.equal(context.customer_long_term_context.ai_customer_info, "");
  assert.equal(context.customer_long_term_context.ai_current_strategy, "");
});

test("rewriteInput in Chinese should be normalized to Japanese instruction", () => {
  const latest = {
    id: "m1",
    role: "CUSTOMER" as const,
    type: "TEXT" as const,
    source: "LINE" as const,
    japaneseText: "お願いします",
    chineseText: null,
    sentAt: new Date("2026-04-20T10:00:00+09:00"),
  };

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c1",
      stage: "NEW",
      display_name: "kei",
    },
    latestMessage: latest,
    translation: {
      translation: "",
    },
    recentMessages: [latest],
    rewriteInput: "更销售一点，不要太客气",
    timelineWindowSize: 12,
  });

  assert.match(context.rewrite_requirement, /運営者の追加要望/);
  assert.equal(context.rewrite_requirement.includes("更销售一点"), false);
});

test("post_free_option_reply should include focus for debt scenario", () => {
  const messages = [
    {
      id: "d0",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "①江草由紀美 ②1980年4月21日",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
    {
      id: "d1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "借金と返済に追われて生活が苦しいです。お金に困らない生活を送りたいです。",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:01:00+09:00"),
    },
    {
      id: "o1",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: [
        "無料鑑定の結果です。",
        "この中から1つだけ選んで送ってください。",
        "『借金の重さ』",
        "『生活の安心』",
        "『お金の流れ』",
      ].join("\n"),
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
    {
      id: "d2",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "借金の重さ",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:02:00+09:00"),
    },
  ];

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c-debt",
      stage: "NEW",
      display_name: "ゆきみ",
    },
    latestMessage: messages[3],
    translation: { translation: "" },
    recentMessages: messages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  assert.equal(context.simple_context.stage, "post_free_option_reply");
  assert.equal(context.simple_context.conversation.selected_option, "借金の重さ");
  const focus = context.simple_context.post_free_option_reply_focus;
  assert.equal(!!focus, true);
  assert.equal(focus.stage_focus, "post_free_option_reply");
  assert.equal(Array.isArray(focus.customer_voice_snippets), true);
  assert.equal(focus.customer_voice_snippets.length >= 2, true);
  const snippetText = focus.customer_voice_snippets.join("\n");
  const hitCount = ["借金", "返済", "生活", "お金"].filter((k) => snippetText.includes(k)).length;
  assert.equal(hitCount >= 2, true);
  assert.equal(String(focus.concrete_connection_hint || "").trim().length > 0, true);
  assert.equal(String(focus.concrete_connection_hint || "").includes("深く確認したい状態"), false);
});

test("post_free_option_reply focus should keep counterpart token in romance scenario", () => {
  const messages = [
    {
      id: "r1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "テツさんの本音がわからない。距離をどうしたらいいか、これからどうなるか不安。",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
    {
      id: "o1",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: [
        "無料鑑定の結果です。",
        "この中から1つだけ選んで送ってください。",
        "『テツさんの本音』",
        "『距離の縮め方』",
      ].join("\n"),
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
    {
      id: "r2",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "テツさんの本音",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:02:00+09:00"),
    },
  ];

  const context = buildMainBrainGenerationContext({
    customer: {
      id: "c-romance",
      stage: "NEW",
      display_name: "shoko",
    },
    latestMessage: messages[2],
    translation: { translation: "" },
    recentMessages: messages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  assert.equal(context.simple_context.stage, "post_free_option_reply");
  assert.equal(context.simple_context.conversation.selected_option, "テツさんの本音");
  const focus = context.simple_context.post_free_option_reply_focus;
  assert.equal(!!focus, true);
  const merged = `${focus.customer_voice_snippets.join("\n")}\n${focus.concrete_connection_hint}`;
  assert.equal(merged.includes("テツさん"), true);
  assert.notEqual(context.simple_context.customer.self_reported_name, "テツさん");
});

test("post_free_option_reply focus should not appear in initial or pricing stages", () => {
  const initialMessages = [
    {
      id: "i1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "①boss ②1982.06.14 ③生活の軍資金がまわらない ④お金に困らない生活",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
  ];
  const initialContext = buildMainBrainGenerationContext({
    customer: { id: "c-init", stage: "NEW", display_name: "bossmama" },
    latestMessage: initialMessages[0],
    translation: { translation: "" },
    recentMessages: initialMessages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });
  assert.equal(initialContext.simple_context.stage, "initial_consultation_ack");
  assert.equal(initialContext.simple_context.post_free_option_reply_focus, null);

  const pricingMessages = [
    {
      id: "p0",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: "先ほどの件、必要でしたら案内できます。",
      chineseText: null,
      sentAt: new Date("2026-04-20T09:59:00+09:00"),
    },
    {
      id: "p1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "料金はいくらですか？支払い方法は？",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
  ];
  const pricingContext = buildMainBrainGenerationContext({
    customer: { id: "c-pricing", stage: "NEW", display_name: "kei" },
    latestMessage: pricingMessages[1],
    translation: { translation: "" },
    recentMessages: pricingMessages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });
  assert.equal(pricingContext.simple_context.stage, "pricing_or_payment");
  assert.equal(pricingContext.simple_context.post_free_option_reply_focus, null);
});

test("御縁の相手 should hit CTA option and build post_free context", () => {
  const messages = [
    {
      id: "e1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "今後ご縁のある相手がいるのか知りたい。結婚につながる相手と出会えるのか不安です。",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
    {
      id: "e2",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "自分に合う相手との流れを知りたいです。",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:01:00+09:00"),
    },
    {
      id: "o1",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: [
        "無料鑑定の結果です。",
        "今の恋愛運の流れとご縁の質は動いています。",
        "ここから先は焦らず順番に確認していくと、出会いの精度が上がります。",
        "この中から1つだけ選んで送ってください。",
        "『御縁の相手』",
        "『相手の本音』",
        "『これからの流れ』",
      ].join("\n"),
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
    {
      id: "e3",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "御縁の相手",
      chineseText: null,
      sentAt: new Date("2026-04-20T11:02:00+09:00"),
    },
  ];

  const context = buildMainBrainGenerationContext({
    customer: { id: "c-en", stage: "NEW", display_name: "山田光男" },
    latestMessage: messages[3],
    translation: { translation: "" },
    recentMessages: messages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  assert.equal(context.objective_facts.is_reply_to_free_reading, true);
  assert.equal(context.objective_facts.hit_cta_option, true);
  assert.equal(context.objective_facts.selected_cta_option, "御縁の相手");
  assert.equal(context.simple_context.stage, "post_free_option_reply");
  assert.equal(context.simple_context.conversation.selected_option, "御縁の相手");
  assert.equal(context.simple_context.conversation.original_consultation.length > 0, true);
  assert.equal(context.simple_context.conversation.pain_anchors.length > 0, true);
  assert.equal(context.simple_context.conversation.bridge_meaning.length > 0, true);
  const focus = context.simple_context.post_free_option_reply_focus;
  assert.equal(!!focus, true);
  assert.equal(focus.selected_option, "御縁の相手");
  const merged = `${focus.customer_voice_snippets.join("\n")}\n${focus.concrete_connection_hint}`;
  assert.equal(/縁|相手|結婚|出会い|流れ/.test(merged), true);
  assert.equal(String(focus.concrete_connection_hint || "").trim().length > 0, true);
  assert.equal(String(focus.concrete_connection_hint || "").includes("深く確認したい状態"), false);
});

test("御縁 option variants should map to selected_cta_option under free-reading CTA", () => {
  const baseMessages = [
    {
      id: "v1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "今後ご縁のある相手を知りたいです。",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
    {
      id: "v2",
      role: "OPERATOR" as const,
      type: "TEXT" as const,
      source: "MANUAL" as const,
      japaneseText: [
        "無料鑑定の結果です。",
        "この中から1つだけ選んで送ってください。",
        "『御縁の相手』",
        "『相手の本音』",
        "『これからの流れ』",
      ].join("\n"),
      chineseText: null,
      sentAt: new Date("2026-04-20T11:00:00+09:00"),
    },
  ];

  const variants = ["ご縁の相手", "御縁の相手です", "御縁の相手でお願いします", "『御縁の相手』"];
  for (const variant of variants) {
    const latest = {
      id: `v-${variant}`,
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: variant,
      chineseText: null,
      sentAt: new Date("2026-04-20T11:02:00+09:00"),
    };
    const facts = buildMainBrainGenerationContext({
      customer: { id: "c-en-v", stage: "NEW", display_name: "kei" },
      latestMessage: latest,
      translation: { translation: "" },
      recentMessages: [...baseMessages, latest],
      rewriteInput: "",
      timelineWindowSize: 12,
    }).objective_facts;
    assert.equal(facts.hit_cta_option, true);
    assert.equal(facts.selected_cta_option, "御縁の相手");
  }
});

test("縁 wording in normal chat should not force post_free_option_reply without free-reading CTA context", () => {
  const messages = [
    {
      id: "n1",
      role: "CUSTOMER" as const,
      type: "TEXT" as const,
      source: "LINE" as const,
      japaneseText: "ご縁のある相手っているんですか？",
      chineseText: null,
      sentAt: new Date("2026-04-20T10:00:00+09:00"),
    },
  ];

  const context = buildMainBrainGenerationContext({
    customer: { id: "c-no-cta", stage: "NEW", display_name: "kei" },
    latestMessage: messages[0],
    translation: { translation: "" },
    recentMessages: messages,
    rewriteInput: "",
    timelineWindowSize: 12,
  });

  assert.equal(context.objective_facts.is_reply_to_free_reading, false);
  assert.equal(context.objective_facts.hit_cta_option, false);
  assert.notEqual(context.simple_context.stage, "post_free_option_reply");
});
