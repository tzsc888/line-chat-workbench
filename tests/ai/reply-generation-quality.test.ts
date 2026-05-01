import test from "node:test";
import assert from "node:assert/strict";
import { __testOnly } from "../../lib/ai/reply-generation-service";
import fs from "node:fs";
import path from "node:path";

test("quality check rejects over-3 bubbles and near-identical A/B", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: false,
        hit_cta_option: false,
      },
    },
    "① a\n② b\n③ c\n① d",
    "① a\n② b\n③ c\n① d",
  );

  assert.equal(errors.some((e) => e.includes("exceeds 3 bubbles")), true);
  assert.equal(errors.some((e) => e.includes("too similar")), true);
});

test("quality check enforces bridge semantic in free-reading option scenario", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
      },
    },
    "視ていきます。少しお待ちください",
    "受け取りました。少しお待ちください",
  );

  assert.equal(errors.some((e) => e.includes("wait-only")), true);
  assert.equal(
    errors.some((e) => e.includes("requires both boundary and guidance semantics")),
    true,
  );
});

test("quality bridge semantic should pass with stronger paid-bridge terms", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
      },
    },
    "ここから先は無料の範囲だけでは軽く言い切れないので、個別に詳しく見る形でご案内できます。",
    "相手の本音は個人の流れとして深く見る必要があるので、鑑定の形でご案内します。",
  );

  assert.equal(
    errors.some((e) => e.includes("requires both boundary and guidance semantics")),
    false,
  );
});

test("quality should fail when non-wait text still lacks boundary and guidance in option scenario", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
      },
    },
    "選んでくれてありがとうございます。丁寧に辿っていきますね。",
    "今の流れをもう一段深く視ていきます。",
  );

  assert.equal(
    errors.some((e) => e.includes("requires both boundary and guidance semantics")),
    true,
  );
});

test("quality should not mark wait-only when wait phrase appears with boundary and guidance semantics", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
      },
      post_free_reading_bridge_context: {
        pain_anchors: ["金銭面", "子供達"],
      },
    },
    "受け取りました。ここから先は無料の範囲だけでは言い切れないので、金銭面は個別鑑定で見た方がいいです。",
    "お金の流れは個人の流れとして詳しく見る必要があります。必要でしたらこのまま詳しい鑑定の形でご案内できます。",
  );

  assert.equal(errors.some((e) => e.includes("wait-only")), false);
  assert.equal(
    errors.some((e) => e.includes("requires both boundary and guidance semantics")),
    false,
  );
});

test("quality should fail when multiple paragraphs have no ①②③ markers", () => {
  const errors = __testOnly.buildQualityErrors(
    { objective_facts: { is_reply_to_free_reading: false, hit_cta_option: false } },
    "一段落目です。\n\n二段落目です。",
    "通常の一段落です。",
  );
  assert.equal(errors.some((e) => e.includes("multiple bubbles must use ①②③ markers")), true);
});

test("quality should fail when option bridge has no customer-specific pain anchors in both A/B", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "ここから先は無料の範囲を超えるので個別鑑定で見ていきます。",
    "無料鑑定の表面より奥なので、必要でしたらこのまま詳しい鑑定の形でご案内できます。",
  );
  assert.equal(
    errors.some((e) => e.includes("option bridge reply must reference customer-specific pain/background")),
    true,
  );
});

test("quality should fail when B has no clearer next-step entrance in option bridge scenario", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "ここから先は無料の範囲だけでは言い切れないので、金銭面は個別に見た方がいいです。",
    "金銭面は無料鑑定の表面より奥の層です。",
  );
  assert.equal(
    errors.some((e) => e.includes("B should open clearer next-step entrance in option bridge scenario")),
    true,
  );
});

test("quality should pass when B opens clearer next-step entrance in option bridge scenario", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "ここから先は無料の範囲だけでは言い切れないので、金銭面は個別に深く見た方がいいです。",
    "必要でしたらこのまま詳しい鑑定の形で、金銭面を個別鑑定としてご案内できます。",
  );
  assert.equal(
    errors.some((e) => e.includes("B should open clearer next-step entrance in option bridge scenario")),
    false,
  );
});

test("quality should fail when bubble ③ is too long in option bridge scenario", () => {
  const longTail = "ここから先は無料の範囲を超えるため個別鑑定で見ていく必要があります。".repeat(8);
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    `① お金の流れですね\n② 金銭面の不安は続いていますよね\n③ ${longTail}`,
    "① お金の流れですね\n② ここから先は無料の範囲を超えます\n③ ここから先は個別に見た方がいい部分です。",
  );
  assert.equal(errors.some((e) => e.includes("bubble is too long for LINE option bridge")), true);
});

test("quality should fail when option bridge reply contains servicey phrase お声がけください", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "① お金の流れですね\n② 金銭面は無料の範囲を超える部分です\n③ 詳しく見たい場合はお声がけください。",
    "① 生活の土台に関わるため\n② 個別鑑定で見た方が自然です\n③ 必要でしたらこのまま詳しい鑑定の形でご案内できます。",
  );
  assert.equal(errors.some((e) => e.includes("option bridge reply sounds too service-explanatory")), true);
});

test("quality should pass with natural short momo-like ①②③ option bridge replies", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① お金の流れですね\n② 金銭面の不安は、子供達との生活の安心にもつながっていますよね\n③ ここから先は無料の範囲を超えるので、個別に見た方が自然です。",
    "① お金の流れですね\n② 子供達との暮らしを守る視点でも、ここは大事な層です\n③ 必要でしたら、このまま詳しい鑑定の形でご案内できます。",
  );
  assert.equal(errors.length, 0);
});

test("quality should fail when long explanatory ② appears in option bridge scenario", () => {
  const long2 =
    "② ももさんが最初に伝えてくれた金銭面も含めてどう動くべきかという問いは、その奥にある生活基盤の不安と将来設計の揺れに繋がっていて、ここを丁寧に重ねて説明しないと見誤りやすい部分です。";
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    `① 『お金の流れ』ですね\n${long2}\n③ ここから先は個別に見た方がいい部分です。`,
    "① 『お金の流れ』ですね\n② 金銭面は子供達との生活にも繋がりますよね\n③ 必要でしたらこのまま、詳しく見る形にできます。",
  );
  assert.equal(errors.some((e) => e.includes("bubble is too long for LINE option bridge")), true);
});

test("quality should fail when both A and B open clear next-step entrance", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "① お金の流れですね\n② 金銭面は生活にも響きます\n③ 必要でしたらこのまま詳しい鑑定の形でご案内できます。",
    "① お金の流れですね\n② ここは無料の範囲を超えます\n③ 必要でしたらこのまま詳しい鑑定の形でご案内できます。",
  );
  assert.equal(
    errors.some((e) => e.includes("A should stay lower-pressure; reserve clear entrance mainly for B")),
    true,
  );
});

test("quality should pass when B uses 必要でしたらこのまま、詳しく見る形にできます", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② 金銭面は子供達との生活にも繋がりますよね\n③ ここから先は個別に見た方がいい部分です。",
    "① 『お金の流れ』ですね\n② ここは無料鑑定の表面だけだと浅くなりやすいです\n③ 必要でしたらこのまま、詳しく見る形にできます。",
  );
  assert.equal(errors.length, 0);
});

test("quality should fail when option bridge uses long three bubbles", () => {
  const longLine =
    "ここは無料鑑定の表面だけでは言い切れないため、背景を重ねて丁寧に整理しながら個別鑑定で見ていく必要がある層です。";
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    `① 『お金の流れ』ですね。${longLine}\n② 金銭面と子供達の安心にも関わるので、${longLine}\n③ ${longLine}`,
    "① 『お金の流れ』ですね\n② 金銭面は子供達との生活にも繋がります\n③ 必要でしたらこのまま、金銭面を詳しい鑑定の形で見ていけます。",
  );
  assert.equal(errors.length > 0, true);
});

test("quality should pass with two short bubbles and light baton in B", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね。そこが気になるのは自然です。\n② 金銭面は子供達との生活にも繋がるので、ここは無料の範囲を超える層です。",
    "① 『お金の流れ』ですね。\n② 金銭面は個別に見た方が自然です。必要でしたらこのまま、見てみたい場合は「お願いします」だけで大丈夫です。",
  );
  assert.equal(errors.length, 0);
});

test("quality should fail when B has explanation ending without conversation baton", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      current_customer_turn: { joined_text: "詳しく知りたいです" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "『お金の流れ』ですね。ここは無料の範囲を超える部分です。",
    "金銭面は生活の不安と直結するため、個別に見た方がよい層です。",
  );
  assert.equal(errors.some((e) => e.includes("B should include a light conversation baton in option bridge scenario")), true);
});

test("quality should fail when strong closing phrase 買いますか appears", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "『お金の流れ』ですね。個別に見た方がいい部分です。",
    "このまま詳しく見られます。買いますか？",
  );
  assert.equal(errors.some((e) => e.includes("option bridge reply sounds too service-explanatory")), true);
});

test("quality should pass when A is low-pressure and B has light baton", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね。\n② 子供達との生活にも繋がるので、ここは無料の範囲を超える層です。",
    "① 『お金の流れ』ですね。\n② 必要でしたらこのまま、子供達との生活を個別鑑定として詳しく見る形にできます。",
  );
  assert.equal(errors.length, 0);
});

test("bare option reply should pass without お願いします baton when bridge semantics are present", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② 金銭面は子供達との生活にも繋がるので、ここは無料の範囲を超える層です。\n③ どこから整えると安心に繋がるのかを個別に見た方がいい部分です。",
    "① 『お金の流れ』ですね\n② ここから先は無料鑑定の表面だけで軽く見るより、\nももさん個人の流れとしてどこで不安が強くなるのかを見た方がいい部分です。",
  );
  assert.equal(errors.includes("B should include a light conversation baton in option bridge scenario"), false);
  assert.equal(errors.includes("bare option reply should not use strong reply-cue baton yet"), false);
  assert.equal(errors.includes("bare option reply should not open next-step entrance yet"), false);
  assert.equal(errors.length, 0);
});

test("bare option should fail when only empathy exists without individual deep-reading value", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "『お金の流れ』ですね。そこが気になるのは自然です。",
    "『お金の流れ』ですね。不安になりますよね。",
  );
  assert.equal(errors.includes("bare option reply should seed individual deep-reading value, not only empathize"), true);
});

test("bare option reply should fail when B uses strong お願いします cue too early", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② 金銭面は子供達との生活にも繋がるので、ここは無料の範囲を超える層です。",
    "① 『お金の流れ』ですね\n② ここは個別に見た方がいい部分です。見てみたい場合は「お願いします」だけで大丈夫です。",
  );
  assert.equal(errors.includes("bare option reply should not open next-step entrance yet"), true);
  assert.equal(errors.includes("bare option reply should not use strong reply-cue baton yet"), true);
});

test("bare option reply should fail when B opens entrance without role coverage", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② 金銭面は子供達との生活にも繋がるので、ここは無料の範囲を超える層です。",
    "① 『お金の流れ』ですね\n② 必要でしたら、このまま詳しい鑑定の形でご案内できます。",
  );
  assert.equal(
    errors.includes("B paid-reading entrance requires acceptance, customer-specific connection, and individual-deep-reading value first"),
    true,
  );
});

test("bare option reply should fail when strong cue contains 申し込みますか", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "ここは個別に見た方がいい部分です。",
    "ここは個別に深く見た方がいいところです。申し込みますか？",
  );
  assert.equal(errors.includes("bare option reply should not open next-step entrance yet"), true);
});

test("detail request after free-reading should require conversation baton in B", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "詳しく知りたいです" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "『お金の流れ』ですね。ここは無料の範囲を超えるので個別に見た方がいい部分です。",
    "金銭面は無料鑑定の表面だけでは浅くなりやすいので、個別に見る層です。",
  );
  assert.equal(errors.includes("B should include a light conversation baton in option bridge scenario"), true);
});

test("detail request after free-reading may pass with お願いします baton", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お願いします" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "『お金の流れ』ですね。ここは無料の範囲を超えるので、金銭面は個別に見た方がいい部分です。",
    "詳しく知りたい内容なので、このまま個別鑑定の形に進められます。見てみたい場合は「お願いします」だけで大丈夫です。",
  );
  assert.equal(errors.includes("B should include a light conversation baton in option bridge scenario"), false);
});


test("normalizeBubbleSpacing should insert blank lines between ①②③", () => {
  const input = "① a\n② b\n③ c";
  const output = __testOnly.normalizeBubbleSpacing(input);
  assert.equal(output, "① a\n\n② b\n\n③ c");
});

test("option bridge should fail when abstract reading-service words are stacked", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "波動と奥の層を丁寧に辿る必要があります。表面だけではなく正確に見るために個別鑑定で進めます。",
    "ここから先は無料の範囲を超えるので、金銭面は個別に見ます。",
  );
  assert.equal(
    errors.includes("reply sounds too abstract / reading-service-like; ground it in customer-specific context"),
    true,
  );
});

test("option bridge should pass when grounded in customer-specific anchor without abstract stacking", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
      current_customer_turn: { joined_text: "お金の流れ" },
    },
    "① お金の流れですね\n② 金銭面の不安は子供達との生活にも繋がるので、ここは無料の範囲を超える層です。",
    "① お金の流れですね\n② ここは無料鑑定の表面だけで軽く見るより、ももさん個人の流れとして見た方がいい部分です。",
  );
  assert.equal(
    errors.includes("reply sounds too abstract / reading-service-like; ground it in customer-specific context"),
    false,
  );
});

test("bare option momo example should pass with no next-step entrance", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達", "生活", "お子さん"] },
    },
    "① 『お金の流れ』ですね\nそこが気になるの、すごく自然だと思います\n\n② お金のことって、ももさんの場合ただ数字の話じゃなくて\nお子さんたちとの生活にも繋がっていますよね\n\n③ どこから整えると安心に繋がるのかを個別に見た方がいい部分です",
    "① 『お金の流れ』ですね\n今いちばん重く感じているのは、やっぱりそこですよね\n\n② ここは無料鑑定の表面だけで軽く見るより、\nももさん個人の流れとしてどこから整えると安心に繋がるのかを見た方がいい部分です",
  );
  assert.equal(errors.includes("bare option reply should not open next-step entrance yet"), false);
  assert.equal(errors.length, 0);
});

test("bare option two-bubble role coverage should pass", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: {
        pain_anchors: ["金銭面", "子供達", "笑ってすごせる未来"],
        original_customer_words: ["現状をどおすればいいか(金銭面も含めて)", "子供達と自分が笑ってすごせる未来"],
        bridge_meaning: "顧客はお金の流れを通じて、子供達との生活と安心を守る方法を深く知りたい状態。",
      },
    },
    "① 『お金の流れ』ですね\nそこが気になるの、すごく自然だと思います\n\n② お金のことって、ももさんの場合ただ数字の話じゃなくて\nお子さんたちとの生活にも繋がっているので、\nどこから整えると安心に繋がるのかを個別に深く見た方がいい部分です",
    "① 『お金の流れ』ですね\n今いちばん重く感じているのは、やっぱりそこですよね\n\n② ここは無料鑑定の表面だけだと\n『お金が不安ですね』で終わってしまいやすい部分です。\n生活の土台のどこから整えると動きやすいかを個別に見た方がいい部分です",
  );
  assert.equal(errors.length, 0);
});

test("momo bare option debug scenario should classify as bare option and not detail request", () => {
  const context = {
    customer: { id: "momo-customer-1" },
    latest_customer_message: { id: "momo-msg-last" },
    current_customer_turn: { joined_text: "お金の流れ" },
    objective_facts: {
      is_reply_to_free_reading: true,
      hit_cta_option: true,
      selected_cta_option: "お金の流れ",
    },
    post_free_reading_bridge_context: {
      selected_option: "お金の流れ",
      original_customer_words: [
        "現状をどおすればいいか(金銭面も含めて)",
        "子供達と自分が笑ってすごせる未来",
      ],
      pain_anchors: ["金銭面", "子供達", "笑ってすごせる未来"],
    },
  };
  const debug = __testOnly.collectScenarioDebug(context);
  assert.equal(debug.isBareCtaOptionReply, true);
  assert.equal(debug.isDetailRequestAfterFreeReading, false);
});

test("bare option may pass when B entrance appears after full role coverage", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② お子さんたちとの生活にも繋がるので、ここは個別に見た方がいい部分です。",
    "① 『お金の流れ』ですね\n② お子さんたちとの生活にも繋がるので、ここは個別に見た方がいい部分です\n\n③ もし詳しい鑑定の形で見ていくなら、内容だけ先にお伝えすることもできますよ。",
  );
  assert.equal(
    errors.includes("B paid-reading entrance requires acceptance, customer-specific connection, and individual-deep-reading value first"),
    false,
  );
});

test("bare option must fail when B says 必要でしたら、まず内容だけ先にお伝えできます", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "① 『お金の流れ』ですね\n② 金銭面は生活にも繋がるので、ここは個別に深く見た方がいいところです。",
    "① 『お金の流れ』ですね\n② 必要でしたら、まず内容だけ先にお伝えできます。",
  );
  assert.equal(
    errors.includes("B paid-reading entrance requires acceptance, customer-specific connection, and individual-deep-reading value first"),
    true,
  );
});

test("bare option must fail when B says 必要でしたら、このまま詳しい鑑定の形でご案内できます", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "① 『お金の流れ』ですね\n② 金銭面は生活にも繋がるので、ここは個別に深く見た方がいいところです。",
    "① 『お金の流れ』ですね\n② 必要でしたら、このまま詳しい鑑定の形でご案内できます。",
  );
  assert.equal(
    errors.includes("B paid-reading entrance requires acceptance, customer-specific connection, and individual-deep-reading value first"),
    true,
  );
});

test("bare option must fail when B says 見てみたい場合は『お願いします』だけで大丈夫です", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "① 『お金の流れ』ですね\n② 金銭面は生活にも繋がるので、ここは個別に深く見た方がいいところです。",
    "① 『お金の流れ』ですね\n② 見てみたい場合は「お願いします」だけで大丈夫です。",
  );
  assert.equal(errors.includes("bare option reply should not open next-step entrance yet"), true);
});

test("bare option three-bubble role coverage should pass", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: {
        pain_anchors: ["金銭面", "子供達", "笑ってすごせる未来"],
      },
    },
    "① 『お金の流れ』ですね\nそこが気になるの、すごく自然だと思います\n\n② お金のことって、\nももさんの場合ただ数字の話じゃないですよね\n\n③ お子さんたちとの生活にも繋がっているので\nどこから整えると安心に繋がるのかを個別に見た方がいい部分です",
    "① 『お金の流れ』ですね\n今いちばん重く感じているのは、やっぱりそこですよね\n\n② ここは無料鑑定の表面だけだと\n『お金が不安ですね』で終わってしまいやすい部分です\n\n③ 生活の土台のどこで流れが止まっているのかを個別に深く見た方がいいところです",
  );
  assert.equal(errors.length, 0);
});

test("bare option should fail when missing role coverage (empathy only)", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\nそこが気になるの、自然だと思います\n\n② お金のことって大事ですよね",
    "『お金の流れ』ですね。不安になりますよね。",
  );
  assert.equal(
    errors.includes("bare option reply must cover acceptance, customer-specific connection, and individual-deep-reading value"),
    true,
  );
});

test("bare option should fail when pain exists but value role missing", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["子供達"] },
    },
    "① 『お金の流れ』ですね\n\n② お子さんたちとの生活にも繋がっていますよね",
    "① 『お金の流れ』ですね\n② 子供達のことは気になりますよね",
  );
  assert.equal(
    errors.includes("bare option reply must cover acceptance, customer-specific connection, and individual-deep-reading value"),
    true,
  );
});

test("detail request can pass with next-step entrance", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "詳しく知りたいです" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
    },
    "『お金の流れ』ですね。ここは無料の範囲を超えるので、金銭面は個別に見た方がいい部分です。",
    "必要でしたら、このまま詳しい鑑定の形でご案内できます。",
  );
  assert.equal(errors.includes("bare option reply should not open next-step entrance yet"), false);
  assert.equal(errors.length, 0);
});

test("should not add fixed selected_option template mapping in generation service", () => {
  const file = fs.readFileSync(path.resolve(process.cwd(), "lib/ai/reply-generation-service.ts"), "utf8");
  assert.equal(/selected_option\s*===\s*["'`]/.test(file), false);
  assert.equal(/selected_cta_option\s*===\s*["'`]/.test(file), false);
});

test("recovery flow should return repair result when first/retry fail and repair passes", () => {
  const context = {
    objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
    current_customer_turn: { joined_text: "お金の流れ" },
    post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
  };
  const result = __testOnly.recoverRepliesFromCandidates(context, [
    {
      reply_a_ja: "受け取りました。少しお待ちください",
      reply_b_ja: "必要でしたら、このまま詳しい鑑定の形でご案内できます。",
    },
    {
      reply_a_ja: "① 『お金の流れ』ですね\n② そこが気になるのは自然です。",
      reply_b_ja: "① 『お金の流れ』ですね\n② 必要でしたら、まず内容だけ先にお伝えできます。",
    },
    {
      reply_a_ja:
        "① 『お金の流れ』ですね\n② お金のことって、ももさんの場合ただ数字の話じゃなくて\nお子さんたちとの生活にも繋がっているので、どこから整えると安心に繋がるのかを個別に深く見た方がいい部分です",
      reply_b_ja:
        "① 『お金の流れ』ですね\n② 無料鑑定の表面だけで軽く見るより、ももさん個人の流れとして生活の土台のどこから整えると動きやすいかを見た方がいい部分です",
    },
  ]);
  assert.equal(result.stage, "repair");
  assert.equal(result.errors.length, 0);
});

test("recovery flow should return bare-option fallback when repair still fails", () => {
  const context = {
    customer: { displayName: "もも" },
    objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
    current_customer_turn: { joined_text: "お金の流れ" },
    post_free_reading_bridge_context: {
      pain_anchors: ["金銭面", "子供達", "笑ってすごせる未来"],
      original_customer_words: ["現状をどおすればいいか(金銭面も含めて)", "子供達と自分が笑ってすごせる未来"],
    },
  };
  const result = __testOnly.recoverRepliesFromCandidates(context, [
    {
      reply_a_ja: "受け取りました。少しお待ちください",
      reply_b_ja: "必要でしたら、このまま詳しい鑑定の形でご案内できます。",
    },
    {
      reply_a_ja: "① 『お金の流れ』ですね\n② 必要でしたら、まず内容だけ先にお伝えできます。",
      reply_b_ja: "① 『お金の流れ』ですね\n② 見てみたい場合は「お願いします」だけで大丈夫です。",
    },
    {
      reply_a_ja: "① 『お金の流れ』ですね\n② そこが気になるのは自然です。",
      reply_b_ja: "① 『お金の流れ』ですね\n② 必要でしたら、ご案内できます。",
    },
  ]);
  assert.equal(result.stage, "fallback");
  assert.equal(result.errors.length, 0);
  assert.equal(result.parsed.reply_a_ja.includes("お金の流れ"), true);
  assert.equal(/子供|お子さん|生活|安心/.test(result.parsed.reply_a_ja + result.parsed.reply_b_ja), true);
  assert.equal(/どこから整えると安心に繋がるのか|どう守るか|生活の土台/.test(result.parsed.reply_a_ja + result.parsed.reply_b_ja), true);
  assert.equal(/お願いしますだけで大丈夫|買いますか|申し込みますか|どうしますか/.test(result.parsed.reply_a_ja + result.parsed.reply_b_ja), false);
});

test("bare option ideal A/B should pass with low-pressure B entrance after role coverage", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達", "生活"] },
    },
    "① 『お金の流れ』ですね\nももさんがそこを選ばれたの、すごく自然だと思います\n\n② 今回のお金の不安って、ただ収入や支出だけじゃなくて、お子さんたちとの生活をどう守るかにも繋がっていますよね\n\n③ ここから先は無料鑑定の範囲で軽く見るより、ももさん個人の流れとして深く見た方がいい部分です",
    "① 『お金の流れ』ですね\n今いちばん重く感じているのは、やっぱりそこですよね\n\n② ここは無料鑑定の表面だけだと「お金が不安ですね」で終わってしまいやすい部分です\n\n③ ももさんの場合は、収入・支出・生活の土台のどこから整えると動きやすいかを個別に深く見た方がいいので、必要でしたらこのまま詳しい鑑定の形をご案内できます",
  );
  assert.equal(errors.length, 0);
});

test("bare option should fail when B contains 内容だけ先に even with role coverage", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達", "生活"] },
    },
    "① 『お金の流れ』ですね\n② お子さんたちとの生活にも繋がっているので、ここは個別に深く見た方がいい部分です。",
    "① 『お金の流れ』ですね\n② 無料鑑定の表面だけで軽く見るより、個別に深く見た方がいい部分です。\n③ 必要でしたら、まず内容だけ先にお伝えできます。",
  );
  assert.equal(
    errors.includes("B paid-reading entrance requires acceptance, customer-specific connection, and individual-deep-reading value first"),
    false,
  );
  assert.equal(errors.includes("bare option reply should not open next-step entrance yet"), true);
});

test("A should not fail paid-entrance check for plain このまま expression", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② このままだと不安が続きやすいので、ここは個別に見た方がいい部分です。",
    "① 『お金の流れ』ですね\n② 無料鑑定の表面だけで軽く見るより、個別に深く見た方がいい部分です。",
  );
  assert.equal(errors.includes("A should stay lower-pressure; reserve clear paid-reading entrance mainly for B"), false);
});

test("B このまま詳しい鑑定の形をご案内できます should pass when role coverage exists", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達", "生活"] },
    },
    "① 『お金の流れ』ですね\n② お子さんたちとの生活にも繋がっているので、ここはどこから整えると安心に繋がるのかを個別に深く見た方がいい部分です。",
    "① 『お金の流れ』ですね\n② お子さんたちとの生活にも繋がるので、無料鑑定の表面だけで軽く見るより生活の土台のどこで流れが止まっているのかを個別に深く見た方がいい部分です。\n③ 必要でしたらこのまま詳しい鑑定の形をご案内できます。",
  );
  assert.equal(errors.length, 0);
});

test("bare option A should fail when A opens clear paid-reading entrance", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② 必要でしたらこのまま詳しい鑑定の形でご案内できます。",
    "① 『お金の流れ』ですね\n② お子さんたちとの生活にも繋がっているので、ここは個別に深く見た方がいい部分です。",
  );
  assert.equal(errors.includes("A should stay lower-pressure; reserve clear paid-reading entrance mainly for B"), true);
});

test("fuzzy bare option 相手の本音 should pass with low-pressure B entrance when role coverage exists", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "相手の本音" },
      current_customer_turn: { joined_text: "相手との本音" },
      post_free_reading_bridge_context: { pain_anchors: ["その子", "気持ち", "距離"] },
    },
    "① 『相手の本音』ですね\n② その子がどう見ているかって、やっぱり気になりますよね。\nここから先は個別に深く見た方がいい部分です。",
    "① 『相手の本音』ですね\n② ここから先は、その子の気持ちの向き方を個別に深く見た方がいい部分です。\n必要でしたら、詳しく見る形でご案内できます。",
  );
  assert.equal(errors.length, 0);
});

test("isBareCtaOptionReply should be true for 相手との本音 when selected option is 相手の本音", () => {
  const context = {
    objective_facts: {
      is_reply_to_free_reading: true,
      hit_cta_option: true,
      selected_cta_option: "相手の本音",
    },
    current_customer_turn: { joined_text: "相手との本音" },
    post_free_reading_bridge_context: {
      pain_anchors: ["その子", "気持ち", "距離"],
    },
  };
  assert.equal(__testOnly.isDetailRequestAfterFreeReading(context), false);
  assert.equal(__testOnly.isBareCtaOptionReply(context), true);
});

test("bare option romance fallback should include connection to その子/気持ち/距離感", () => {
  const context = {
    customer: { displayName: "くりきんとん" },
    objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "相手の本音" },
    current_customer_turn: { joined_text: "相手の本音" },
    post_free_reading_bridge_context: {
      pain_anchors: ["その子", "気持ち", "付き合える"],
      original_customer_words: ["今話してる子が俺の事どー思ってるか知りたい", "その子と付き合える"],
    },
  };
  const fallback = __testOnly.buildBareOptionSafeFallback(context);
  assert.equal(fallback.reply_a_ja.includes("相手の本音"), true);
  assert.equal(/その子|気持ち|距離感/.test(fallback.reply_a_ja + fallback.reply_b_ja), true);
  assert.equal(/個別に見た方がいい部分|個別に深く見た方がいい部分/.test(fallback.reply_a_ja + fallback.reply_b_ja), true);
});

test("momo money fallback should include concrete value hook", () => {
  const fallback = __testOnly.buildBareOptionSafeFallback({
    customer: { display_name: "もも" },
    objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
    current_customer_turn: { joined_text: "お金の流れ" },
    post_free_reading_bridge_context: {
      pain_anchors: ["金銭面", "子供達", "生活の安心"],
      original_customer_words: ["現状をどおすればいいか(金銭面も含めて)", "子供達と自分が笑ってすごせる未来"],
    },
  });
  const text = `${fallback.reply_a_ja}\n${fallback.reply_b_ja}`;
  assert.equal(/お金の不安/.test(text), true);
  assert.equal(/お子さんたちとの生活/.test(text), true);
  assert.equal(/どう守るか|どこから整えると安心に繋がるのか/.test(text), true);
});

test("withSan should add さん when missing", () => {
  assert.equal(__testOnly.withSan("もも"), "ももさん");
});

test("withSan should avoid double honorific", () => {
  assert.equal(__testOnly.withSan("ももさん"), "ももさん");
  const fallback = __testOnly.buildBareOptionSafeFallback({
    customer: { displayName: "ももさん" },
    objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
    current_customer_turn: { joined_text: "お金の流れ" },
    post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
  });
  assert.equal(fallback.reply_b_ja.includes("ももさんさん"), false);
  assert.equal(fallback.reply_b_ja.includes("お客様個人の流れ"), false);
});

test("withSan should fallback safely for empty name", () => {
  assert.equal(__testOnly.withSan(""), "お客様");
  const fallback = __testOnly.buildBareOptionSafeFallback({
    customer: { displayName: "" },
    objective_facts: { is_reply_to_free_reading: true, hit_cta_option: true, selected_cta_option: "お金の流れ" },
    current_customer_turn: { joined_text: "お金の流れ" },
    post_free_reading_bridge_context: { pain_anchors: ["金銭面"] },
  });
  assert.equal(/お客様が|お客様の場合|お客様個人/.test(fallback.reply_a_ja + fallback.reply_b_ja), true);
});

test("bare option should fail when value seed has no concrete curiosity hook", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "お金の流れ",
      },
      current_customer_turn: { joined_text: "お金の流れ" },
      post_free_reading_bridge_context: { pain_anchors: ["金銭面", "子供達"] },
    },
    "① 『お金の流れ』ですね\n② お子さんたちとの生活にも繋がっているので、ここは個別に深く見た方がいい部分です。",
    "① 『お金の流れ』ですね\n② 無料鑑定の表面だけで軽く見るより、個別に見た方がいい部分です。",
  );
  assert.equal(errors.includes("bare option value seed should include a concrete curiosity hook"), true);
});

test("workplace context ideal reply should stay in workplace pain and avoid money/romance leakage", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "仕事の流れ",
      },
      current_customer_turn: { joined_text: "仕事の流れ" },
      post_free_reading_bridge_context: {
        original_customer_words: ["職場の人間関係がつらい", "毎日気を使って疲れている"],
        pain_anchors: ["職場", "人間関係", "毎日", "疲れている"],
        bridge_meaning: "顧客は職場での負担を深く見たい状態。",
      },
    },
    "① 『仕事の流れ』ですね\n② 職場の人間関係や毎日の気疲れが重なっている部分なので、ここは無料鑑定の表面だけで終わらせるより個別に見た方がいいです。",
    "① 『仕事の流れ』ですね\n② 毎日の負担がどこで強くなるのかを個別に深く見た方がいい部分です。必要でしたらこのまま詳しい鑑定で見ていけます。",
  );
  assert.equal(errors.length, 0);
  const text =
    "① 『仕事の流れ』ですね\n② 職場の人間関係や毎日の気疲れが重なっている部分なので、ここは無料鑑定の表面だけで終わらせるより個別に見た方がいいです。\n" +
    "① 『仕事の流れ』ですね\n② 毎日の負担がどこで強くなるのかを個別に深く見た方がいい部分です。必要でしたらこのまま詳しい鑑定で見ていけます。";
  assert.equal(/職場|人間関係|毎日の負担|気疲れ/.test(text), true);
  assert.equal(/お子さん|その子/.test(text), false);
});

test("family context ideal reply should connect to mother/family pain and avoid money/romance leakage", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "家族との関係",
      },
      current_customer_turn: { joined_text: "家族との関係" },
      post_free_reading_bridge_context: {
        original_customer_words: ["母との関係でずっと悩んでいる", "自分の気持ちを言えない"],
        pain_anchors: ["母", "家族", "言えない気持ち", "悩んでいる"],
        bridge_meaning: "顧客は家族関係の痛点を深く見たい状態。",
      },
    },
    "① 『家族との関係』ですね\n② 母との関係で言えない気持ちが積もっているところは、無料鑑定の表面だけで終わらせるより個別に見た方がいい部分です。",
    "① 『家族との関係』ですね\n② 家族の中でどこで言葉が止まりやすいのかを個別に深く見た方がいいので、必要でしたらこのまま詳しい鑑定で見ていけます。",
  );
  assert.equal(errors.length, 0);
  const text =
    "① 『家族との関係』ですね\n② 母との関係で言えない気持ちが積もっているところは、無料鑑定の表面だけで終わらせるより個別に見た方がいい部分です。\n" +
    "① 『家族との関係』ですね\n② 家族の中でどこで言葉が止まりやすいのかを個別に深く見た方がいいので、必要でしたらこのまま詳しい鑑定で見ていけます。";
  assert.equal(/家族|母|言えない気持ち/.test(text), true);
  assert.equal(/お金|その子/.test(text), false);
});

test("future/life-choice context ideal reply should connect to hesitation/next-step pain and avoid fixed money/romance leakage", () => {
  const errors = __testOnly.buildQualityErrors(
    {
      objective_facts: {
        is_reply_to_free_reading: true,
        hit_cta_option: true,
        selected_cta_option: "これからの流れ",
      },
      current_customer_turn: { joined_text: "これからの流れ" },
      post_free_reading_bridge_context: {
        original_customer_words: ["仕事を変えるべきか迷っている", "この先どう動けばいいか知りたい"],
        pain_anchors: ["仕事", "迷っている", "この先", "どう動けばいいか"],
        bridge_meaning: "顧客は将来の選択と行動順を深く見たい状態。",
      },
    },
    "① 『これからの流れ』ですね\n② 仕事を変えるか迷っている今は、この先どこから動くと軽くなるのかを個別に見た方がいい部分です。",
    "① 『これからの流れ』ですね\n② 無料鑑定の表面だけだと選択の迷いが残りやすいので、どう動けばいいかを個別に深く見た方がいいです。必要でしたらこのまま詳しく見ていけます。",
  );
  assert.equal(errors.length, 0);
  const text =
    "① 『これからの流れ』ですね\n② 仕事を変えるか迷っている今は、この先どこから動くと軽くなるのかを個別に見た方がいい部分です。\n" +
    "① 『これからの流れ』ですね\n② 無料鑑定の表面だけだと選択の迷いが残りやすいので、どう動けばいいかを個別に深く見た方がいいです。必要でしたらこのまま詳しく見ていけます。";
  assert.equal(/迷い|この先|どう動けばいいか|選択/.test(text), true);
  assert.equal(/お子さん|その子/.test(text), false);
});

test("generic unknown fallback should include concrete hook instead of empty generic phrase", () => {
  const fallback = __testOnly.buildBareOptionSafeFallback({
    customer: { displayName: "あき" },
    objective_facts: {
      is_reply_to_free_reading: true,
      hit_cta_option: true,
      selected_cta_option: "今後の流れ",
    },
    current_customer_turn: { joined_text: "今後の流れ" },
    post_free_reading_bridge_context: {
      original_customer_words: ["どうしたらいいかわからない"],
      pain_anchors: ["迷い", "今後"],
      bridge_meaning: "顧客は今後の迷いを深く見たい状態。",
    },
  });
  const text = `${fallback.reply_a_ja}\n${fallback.reply_b_ja}`;
  assert.equal(/今の悩み/.test(text), true);
  assert.equal(/どこで流れが止まっているのか|どう動くと軽くなるのか/.test(text), true);
  assert.equal(/ここは個別に見た方がいい部分です$/.test(text.trim()), false);
});


