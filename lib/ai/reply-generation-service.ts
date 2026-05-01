import { buildChatCompletionsUrl, requestStructuredJsonWithContract } from "./model-client";
import { normalizeGenerationReply, validateMainBrainGenerationResult } from "./protocol-validator";
import { replyGenerationPrompt } from "./prompts/reply-generation";
import { resolveGenerationStrategy } from "./strategy";

const GENERATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply_a_ja", "reply_b_ja"],
  properties: {
    reply_a_ja: { type: "string" },
    reply_b_ja: { type: "string" },
  },
} as const;

function validateGenerationContract(raw: unknown) {
  const normalized = normalizeGenerationReply(raw);
  const errors: string[] = [];
  if (!normalized.reply_a_ja.trim()) {
    errors.push("reply_a_ja must be non-empty string");
  }
  if (!normalized.reply_b_ja.trim()) {
    errors.push("reply_b_ja must be non-empty string");
  }
  return errors;
}

function containsChinese(text: string) {
  const value = String(text || "");
  const hasKana = /[ぁ-んァ-ン]/.test(value);
  const chineseMarkers = /(请|請|谢谢|謝謝|这个|這個|那个|那個|我们|我們|你|我|吗|嗎|呢|了|的|中文|翻译|翻譯|资金|建议|回复|客戶|客户)/.test(
    value,
  );
  return chineseMarkers && !hasKana;
}

function looksInternalMetaText(text: string) {
  return /(reply_a_ja|reply_b_ja|json|schema|metadata|analysis|解説|理由|A案|B案)/i.test(String(text || ""));
}

function normalizeNameFragment(value: string) {
  return String(value || "")
    .trim()
    .replace(/[0-9０-９./\-_\s]/g, "")
    .slice(0, 12);
}

function buildHardQualityErrors(context: Record<string, unknown>, replyA: string, replyB: string) {
  const errors: string[] = [];
  const a = String(replyA || "").trim();
  const b = String(replyB || "").trim();
  const combined = `${a}\n${b}`;
  if (!a || !b) errors.push("empty_reply");
  if (containsChinese(combined)) errors.push("contains_chinese");
  if (looksInternalMetaText(combined)) errors.push("contains_internal_metadata_style_text");
  if (a.replace(/\s+/g, "").length > 500 || b.replace(/\s+/g, "").length > 500) errors.push("reply_too_long");
  if (/(買いますか|申し込みますか|今すぐ申込|申込してください|料金だけ先に)/.test(combined)) {
    errors.push("contains_hard_sales_words");
  }
  const customer = (context.customer as Record<string, unknown> | undefined) || {};
  const internalDisplayName = String(customer.internal_display_name || customer.display_name || customer.displayName || "").trim();
  const selfReportedName = String(customer.self_reported_name || "").trim();
  const internalFragment = normalizeNameFragment(internalDisplayName);
  const selfReportedFragment = normalizeNameFragment(selfReportedName);
  const containsInternalDateLike = /\b202\d\b|\b\d{1,2}[./-]\d{1,2}\b|\b\d{2,4}[./-]\d{1,2}[./-]\d{1,2}\b/.test(combined);
  if (containsInternalDateLike) {
    errors.push("contains_internal_display_name_or_date");
  }
  if (
    internalFragment &&
    internalFragment.length >= 2 &&
    internalFragment !== selfReportedFragment &&
    combined.includes(internalFragment)
  ) {
    errors.push("contains_internal_display_name_or_date");
  }
  return Array.from(new Set(errors));
}

function pickStringArray(input: unknown, fallback: string[] = []) {
  if (!Array.isArray(input)) return fallback;
  return input.map((x) => String(x || "").trim()).filter(Boolean);
}

function buildMinimalModelContext(context: Record<string, unknown>) {
  const c = (context.customer as Record<string, unknown> | undefined) || {};
  const stage = String(context.stage || "").trim() || "general_chat";
  const currentTurn = (context.current_customer_turn as Record<string, unknown> | undefined) || {};
  const turnMessages = Array.isArray(currentTurn.messages)
    ? currentTurn.messages
        .map((m) => {
          const mm = (m as Record<string, unknown>) || {};
          return String(mm.text || mm.message || "").trim();
        })
        .filter(Boolean)
    : [];
  const timing = (context.timing_context as Record<string, unknown> | undefined) || {};
  const bridge = (context.post_free_reading_bridge_context as Record<string, unknown> | undefined) || {};
  const objectiveFacts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  return {
    customer: {
      self_reported_name: String(c.self_reported_name || "").trim(),
      do_not_use_internal_display_name_in_reply: true,
    },
    stage,
    current_turn: {
      messages: turnMessages,
      time_gap_hint: String(timing.time_gap_hint || "").trim() || "unknown",
    },
    conversation: {
      original_consultation: pickStringArray(bridge.original_customer_words),
      last_operator_message_type: Boolean(objectiveFacts.is_reply_to_free_reading) ? "free_reading" : "normal_chat",
      selected_option: String(bridge.selected_option || objectiveFacts.selected_cta_option || "").trim() || null,
      pain_anchors: pickStringArray(bridge.pain_anchors),
      bridge_meaning: String(bridge.bridge_meaning || "").trim(),
    },
    sales_goal: stage === "post_free_option_reply" ? "初回有料鑑定への低圧橋渡し" : "自然な関係維持と次の一歩の明確化",
  };
}

function buildModelContext(context: Record<string, unknown>) {
  const simple = (context.simple_context as Record<string, unknown> | undefined) || null;
  if (!simple || typeof simple !== "object") {
    return buildMinimalModelContext(context);
  }
  const customer = (simple.customer as Record<string, unknown> | undefined) || {};
  const currentTurn = (simple.current_turn as Record<string, unknown> | undefined) || {};
  const conversation = (simple.conversation as Record<string, unknown> | undefined) || {};
  const focus = (simple.post_free_option_reply_focus as Record<string, unknown> | undefined) || null;
  return {
    customer: {
      self_reported_name: String(customer.self_reported_name || "").trim(),
      do_not_use_internal_display_name_in_reply: true,
    },
    stage: String(simple.stage || "").trim() || "general_chat",
    current_turn: {
      messages: pickStringArray(currentTurn.messages),
      time_gap_hint: String(currentTurn.time_gap_hint || "").trim() || "unknown",
    },
    conversation: {
      original_consultation: pickStringArray(conversation.original_consultation),
      last_operator_message_type: String(conversation.last_operator_message_type || "").trim() || "normal_chat",
      selected_option: String(conversation.selected_option || "").trim() || null,
      pain_anchors: pickStringArray(conversation.pain_anchors),
      bridge_meaning: String(conversation.bridge_meaning || "").trim(),
    },
    sales_goal: String(simple.sales_goal || "").trim() || "自然な関係維持と次の一歩の明確化",
    post_free_option_reply_focus: focus
      ? {
          stage_focus: String(focus.stage_focus || "").trim(),
          reply_goal: String(focus.reply_goal || "").trim(),
          selected_option: String(focus.selected_option || "").trim(),
          customer_voice_snippets: pickStringArray(focus.customer_voice_snippets),
          concrete_connection_hint: String(focus.concrete_connection_hint || "").trim(),
          must_do: pickStringArray(focus.must_do),
          avoid: pickStringArray(focus.avoid),
        }
      : null,
  };
}

function normalizeBubbleSpacing(text: string) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  let normalized = source;
  if (/[①②]/.test(normalized)) {
    normalized = normalized.replace(/\n*\s*②/g, "\n\n②");
  }
  if (/③/.test(normalized)) {
    normalized = normalized.replace(/\n*\s*③/g, "\n\n③");
  }
  normalized = normalized.replace(/\n{3,}/g, "\n\n");
  return normalized.trim();
}

function countBubbleMarkers(text: string) {
  const matches = text.match(/[①②③]/g);
  return matches ? matches.length : 0;
}

function hasWaitPhrase(text: string) {
  const value = String(text || "").replace(/\s+/g, "");
  return /(受け取りました|承知しました|視ていきます|少しお待ちください|しばらくお待ちください|少し時間をください|もう少し丁寧に辿っていきます|もう一段深く視ていきます|確認してみますね)/.test(
    value,
  );
}

function looksReportLike(text: string) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  return String(text || "").length > 260 || lines.length >= 7;
}

function hasMultipleParagraphsWithoutBubbleMarkers(text: string) {
  const value = String(text || "");
  const paragraphs = value.split(/\r?\n\s*\r?\n/).map((x) => x.trim()).filter(Boolean);
  const hasBubbleMarker = /[①②③]/.test(value);
  return paragraphs.length >= 2 && !hasBubbleMarker;
}

function splitBubbles(text: string) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!/[①②③]/.test(normalized)) return [];
  const parts = normalized
    .split(/(?=①|②|③)/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts;
}

function hasTooLongBubbleInOptionScenario(text: string) {
  const bubbles = splitBubbles(text);
  if (bubbles.length === 0) return false;
  if (bubbles.length === 3) {
    return bubbles.some((b) => b.replace(/\s+/g, "").length > 80);
  }
  return bubbles.some((b) => b.replace(/\s+/g, "").length > 110);
}

function isThreeBubbleAndTooLong(text: string) {
  const bubbles = splitBubbles(text);
  if (bubbles.length !== 3) return false;
  const total = bubbles.map((b) => b.replace(/\s+/g, "").length).reduce((a, b) => a + b, 0);
  return bubbles.some((b) => b.replace(/\s+/g, "").length > 80) || total > 240;
}

function normalizeForMatch(text: string) {
  return String(text || "").replace(/\s+/g, "");
}

function containsAny(text: string, terms: string[]) {
  const n = normalizeForMatch(text);
  return terms.some((t) => n.includes(normalizeForMatch(t)));
}

function hasBoundarySemantic(text: string) {
  return containsAny(text, [
    "無料の範囲",
    "無料鑑定",
    "表面",
    "ここから先",
    "軽く言い切れない",
    "ここは軽く見るより",
    "もう少し個別に見る部分",
    "深く見た方がいい",
  ]);
}

function hasGuidanceSemantic(text: string) {
  return containsAny(text, [
    "個別",
    "個別鑑定",
    "詳しい鑑定",
    "詳しく見る",
    "深く見る",
    "ご案内",
    "鑑定の形",
    "個人の流れ",
    "ももさん個人の流れ",
    "お金と生活の土台を詳しく",
    "その子の気持ちの向き方を個別に",
  ]);
}

function looksLikeWaitOnlyWithoutBridge(text: string) {
  const compact = String(text || "").replace(/\s+/g, "");
  const hasBoundary = hasBoundarySemantic(text);
  const hasGuidance = hasGuidanceSemantic(text);
  return hasWaitPhrase(text) && !hasBoundary && !hasGuidance && compact.length <= 70;
}

function hasPainAnchorOrSynonym(text: string, anchors: string[]) {
  const groups: string[][] = [];
  for (const anchor of anchors) {
    if (/金銭|お金/.test(anchor)) groups.push(["金銭面", "お金", "金銭"]);
    else if (/子供|子ども|お子/.test(anchor)) groups.push(["子供達", "子ども", "お子さん"]);
    else if (/笑ってすごせる未来|笑顔|安心/.test(anchor)) groups.push(["笑ってすごせる未来", "笑顔", "安心"]);
    else groups.push([anchor]);
  }
  return groups.some((g) => containsAny(text, g));
}

function hasNextStepEntrance(text: string) {
  return containsAny(text, ["必要でしたら", "このまま", "詳しい鑑定", "個別鑑定", "ご案内できます", "詳しく見ていく形"]);
}

function hasServiceyPhrase(text: string) {
  return /(続けたい気持ちがあれば|ご案内できますよ|ご案内をさせてください|お話しさせてもらえますか|お声がけください|正直な答えが出せない|正直なことが言えない|鑑定の中でお伝えできることなんです|買いますか|申し込みますか|どうしますか)/.test(
    String(text || ""),
  );
}

function looksTooAbstractReadingServiceLike(text: string) {
  const terms = ["波動", "奥の層", "辿る必要", "表面だけではなく", "正確に見る", "個別の波動", "丁寧に辿る", "鑑定の中でお伝え"];
  const matched = terms.filter((t) => containsAny(text, [t]));
  if (matched.length >= 3) return true;
  const compact = normalizeForMatch(text);
  return compact.length <= 120 && matched.length >= 2;
}

function hasClearEntrancePhrase(text: string) {
  return /(必要でしたら|このまま|詳しい鑑定|個別鑑定|ご案内できます|詳しく見ていく形)/.test(String(text || ""));
}

function hasPaidEntranceCue(text: string) {
  return containsAny(text, [
    "必要でしたら",
    "詳しい鑑定",
    "個別鑑定",
    "ご案内できます",
    "お伝えできます",
    "詳しく見ていく形",
    "このまま詳しい鑑定",
    "このまま個別鑑定",
    "このまま見ていく",
    "このままご案内",
    "このまま進め",
  ]);
}

function hasConversationBaton(text: string) {
  return containsAny(text, [
    "大丈夫ですか",
    "お伝えしても",
    "お願いします",
    "見てみたい場合",
    "内容だけ",
    "先にお伝え",
    "このまま",
    "必要でしたら",
    "進められます",
    "見ていけます",
  ]);
}

function hasBareOptionNextStepEntrance(text: string) {
  return containsAny(text, [
    "内容だけ先に",
    "まず内容だけ先に",
    "お願いします」だけで大丈夫",
    "お願いしますだけで大丈夫",
    "見てみたい場合は「お願いします」だけで大丈夫です",
    "見てみたい場合は『お願いします』だけで大丈夫です",
    "買いますか",
    "申し込みますか",
    "どうしますか",
    "今すぐ申込",
    "申込してください",
    "料金だけ先に",
  ]);
}

function hasIndividualDeepValueSemantic(text: string) {
  return containsAny(text, [
    "個別に見た方がいい部分",
    "個別に深く見た方がいいところ",
    "個人の流れとして見た方がいい",
    "無料鑑定の表面だけだと",
    "ここから先は個別に見る部分",
    "個別に見た方がいい",
    "個別に深く見た方がいい",
  ]);
}

function hasAcceptanceRole(text: string, context: Record<string, unknown>) {
  const facts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  const selected = String(facts.selected_cta_option || "").trim();
  const turn = getCurrentCustomerTurnJoinedText(context);
  if (selected && containsAny(text, [selected])) return true;
  if (turn && containsAny(text, [turn])) return true;
  return containsAny(text, ["ですね", "そうですね", "受け取りました", "ありがとうございます"]);
}

function hasConnectionRole(text: string, context: Record<string, unknown>) {
  const bridgeContext = (context.post_free_reading_bridge_context as Record<string, unknown> | undefined) || {};
  const anchors = Array.isArray(bridgeContext.pain_anchors)
    ? bridgeContext.pain_anchors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (anchors.length > 0 && hasPainAnchorOrSynonym(text, anchors)) return true;
  const originalWords = Array.isArray(bridgeContext.original_customer_words)
    ? bridgeContext.original_customer_words.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const concreteHints = [
    "金銭面",
    "お金",
    "生活",
    "子供達",
    "お子さん",
    "子ども",
    "笑ってすごせる未来",
    "笑顔",
    "安心",
    "相手の本音",
    "その子",
    "気持ち",
    "どう見ている",
    "距離",
    "関係",
    "付き合える",
  ];
  if (containsAny(text, concreteHints)) return true;
  const mergedOriginal = originalWords.join(" ");
  if (containsAny(text, [mergedOriginal])) return true;
  const bridgeMeaning = String(bridgeContext.bridge_meaning || "").trim();
  if (bridgeMeaning && containsAny(text, ["生活", "安心", "気持ち", "距離", "未来", "守る"])) return true;
  return false;
}

function hasValueRole(text: string) {
  return containsAny(text, [
    "個別に見た方がいい",
    "個別に深く見た方がいい",
    "個別に見る部分",
    "無料鑑定の表面",
    "表面だけで終わらせるより",
    "ここから先は個別",
    "個人の流れとして見た方がいい",
    "軽く見るより",
  ]);
}

function hasBareOptionRoleCoverage(text: string, context: Record<string, unknown>) {
  return hasAcceptanceRole(text, context) && hasConnectionRole(text, context) && hasValueRole(text);
}

function collectScenarioDebug(context: Record<string, unknown>) {
  const facts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  const bridge = (context.post_free_reading_bridge_context as Record<string, unknown> | undefined) || {};
  const customer = (context.customer as Record<string, unknown> | undefined) || {};
  const latestMessage = (context.latest_customer_message as Record<string, unknown> | undefined) || {};
  const currentTurnText = getCurrentCustomerTurnJoinedText(context);
  return {
    customerId: String(customer.id || ""),
    targetMessageId: String(latestMessage.id || ""),
    currentCustomerTurnJoinedText: currentTurnText,
    objectiveFacts: {
      is_reply_to_free_reading: Boolean(facts.is_reply_to_free_reading),
      hit_cta_option: Boolean(facts.hit_cta_option),
      selected_cta_option: String(facts.selected_cta_option || ""),
    },
    postFreeReadingBridgeContext: {
      selected_option: String(bridge.selected_option || ""),
      original_customer_words: Array.isArray(bridge.original_customer_words)
        ? bridge.original_customer_words.map((x) => String(x || ""))
        : [],
      pain_anchors: Array.isArray(bridge.pain_anchors) ? bridge.pain_anchors.map((x) => String(x || "")) : [],
    },
    isBareCtaOptionReply: isBareCtaOptionReply(context),
    isDetailRequestAfterFreeReading: isDetailRequestAfterFreeReading(context),
    isOptionBridgeScenario: Boolean(facts.is_reply_to_free_reading) && Boolean(facts.hit_cta_option),
  };
}

function getBridgeContext(context: Record<string, unknown>) {
  return (context.post_free_reading_bridge_context as Record<string, unknown> | undefined) || {};
}

function buildFinalRepairInstruction(
  context: Record<string, unknown>,
  replyA: string,
  replyB: string,
  errors: string[],
) {
  const facts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  const selected = String(facts.selected_cta_option || "").trim();
  const bridge = getBridgeContext(context);
  const anchors = Array.isArray(bridge.pain_anchors) ? bridge.pain_anchors.map((x) => String(x || "")).filter(Boolean) : [];
  const originals = Array.isArray(bridge.original_customer_words)
    ? bridge.original_customer_words.map((x) => String(x || "")).filter(Boolean)
    : [];
  return [
    "Final repair pass. Fix only reply_a_ja and reply_b_ja. Output JSON only.",
    "This is bare option reply, not detail request.",
    "Do NOT include strong closing cues: 「お願いします」だけで大丈夫 / 買いますか / 申し込みますか / どうしますか / 今すぐ申込 / 申込してください / 料金だけ先に",
    "Must include: 受け止め + customer-specific pain connection + individual deep-reading value.",
    "Value must include a concrete curiosity hook, not only '個別に見た方がいい'. Keep it short and LINE-natural.",
    "Concrete hook examples: どこから整えると安心に繋がるのか / どこで流れが止まっているのか / 収入・支出・生活の土台のどこから整えると動きやすいか / その子がどう見ているのか / 友達としてなのか少し意識しているのか / 距離をどう縮めると自然なのか.",
    "Prefer 1-2 bubbles. Keep each bubble short. 2 bubbles can still cover all 3 roles naturally.",
    "No explanation, no extra keys.",
    `selected_cta_option: ${selected || "(none)"}`,
    `pain_anchors: ${anchors.join(" / ") || "(none)"}`,
    `original_customer_words: ${originals.join(" / ") || "(none)"}`,
    `quality_errors_to_fix: ${errors.join(" | ")}`,
    `previous_reply_a_ja: ${replyA}`,
    `previous_reply_b_ja: ${replyB}`,
  ].join("\n");
}

function pickDisplayName(context: Record<string, unknown>) {
  const customer = (context.customer as Record<string, unknown> | undefined) || {};
  const profile = (context.customer_profile as Record<string, unknown> | undefined) || {};
  const name = String(
    customer.display_name ||
      customer.displayName ||
      customer.name ||
      profile.display_name ||
      profile.displayName ||
      "",
  ).trim();
  return name;
}

function withSan(name: string) {
  const value = String(name || "").trim();
  if (!value) return "お客様";
  if (/(さん|様|先生)$/.test(value)) return value;
  return `${value}さん`;
}

function buildConnectionPhrase(context: Record<string, unknown>) {
  const bridge = getBridgeContext(context);
  const anchors = Array.isArray(bridge.pain_anchors)
    ? bridge.pain_anchors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const originalWords = Array.isArray(bridge.original_customer_words)
    ? bridge.original_customer_words.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const pool = `${anchors.join(" ")} ${originalWords.join(" ")} ${String(bridge.bridge_meaning || "")}`;
  if (/(金銭|お金)/.test(pool) && /(子供|子ども|お子|生活|安心)/.test(pool)) {
    return "お金のことって、ただ数字の話じゃなくて、お子さんたちとの生活にも繋がっている";
  }
  if (/(相手|その子|気持ち|本音|距離|付き合)/.test(pool)) {
    return "その子がどう見ているのかや、これからの距離感にも繋がっている";
  }
  if (/(仕事|職場|人間関係|負担)/.test(pool)) {
    return "毎日の負担や、職場での関わり方にも繋がっている";
  }
  return "今の悩みの根っこにも繋がっている";
}

function buildBareOptionSafeFallback(context: Record<string, unknown>) {
  const facts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  const selected = String(facts.selected_cta_option || getCurrentCustomerTurnJoinedText(context) || "このテーマ").trim();
  const displayName = withSan(pickDisplayName(context));
  const bridge = getBridgeContext(context);
  const anchors = Array.isArray(bridge.pain_anchors)
    ? bridge.pain_anchors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const originalWords = Array.isArray(bridge.original_customer_words)
    ? bridge.original_customer_words.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const pool = `${selected} ${anchors.join(" ")} ${originalWords.join(" ")} ${String(bridge.bridge_meaning || "")}`;
  const moneyLife = /(金銭|お金|子供|子ども|お子|生活|安心|笑ってすごせる未来)/.test(pool);
  const romance = /(相手|その子|本音|気持ち|距離|付き合える)/.test(pool);

  const safeA = moneyLife
    ? normalizeBubbleSpacing(
        `① 『${selected}』ですね\n${displayName}がそこを選ばれたの、すごく自然だと思います\n\n② お金の不安って、お子さんたちとの生活をどう守るかにも直結していますよね\n\n③ ここは無料鑑定の表面より、どこから整えると安心に繋がるのかを個別に見た方がいい部分です`,
      )
    : romance
      ? normalizeBubbleSpacing(
          `① 『${selected}』ですね\nやっぱり一番気になるのはそこですよね\n\n② 話せているからこそ、\nその子がどう見ているのか分からないと\n余計に気持ちが揺れますよね\n\n③ ここから先は、\nその子の気持ちの向き方を個別に見た方がいい部分です`,
        )
      : normalizeBubbleSpacing(
          `① 『${selected}』ですね\nそこが気になるの、自然だと思います\n\n② その言葉は、今の悩みの根っこにも繋がっているので、\nここから先は個別に見た方がいい部分です。\nどこで流れが止まっているのかを短く押さえると進めやすくなります`,
        );
  const safeB = moneyLife
    ? normalizeBubbleSpacing(
        `① 『${selected}』ですね\n今いちばん重く感じているのは、やっぱりそこですよね\n\n② ここは無料鑑定の表面だけだと「お金が不安ですね」で終わってしまいやすい部分です\n\n③ 収入・支出・生活の土台のどこから整えると動きやすいかを個別に見た方がいいので、必要でしたらこのまま詳しい鑑定で見ていけます`,
      )
    : romance
      ? normalizeBubbleSpacing(
          `① 『${selected}』ですね\nそこが見えないと、動き方も迷いやすいですよね\n\n② 友達として見ているのか、\n少し意識しているのかは、\n無料鑑定の表面だけだと言い切りにくいところです\n\n③ 必要でしたら、\nその子の本音を詳しく見る形でご案内できます`,
        )
      : normalizeBubbleSpacing(
          `① 『${selected}』ですね\n今いちばん引っかかっているのは、そこですよね\n\n② 無料鑑定の表面だけで軽く見るより、\n${displayName}個人の流れとして深く見た方がいい部分です\n\n③ 必要でしたら、\n詳しい鑑定の形でご案内できます`,
        );
  return { reply_a_ja: safeA, reply_b_ja: safeB };
}

function recoverRepliesFromCandidates(
  context: Record<string, unknown>,
  candidates: Array<{ reply_a_ja: string; reply_b_ja: string }>,
) {
  const normalized = candidates.map((c) => ({
    reply_a_ja: normalizeBubbleSpacing(c.reply_a_ja),
    reply_b_ja: normalizeBubbleSpacing(c.reply_b_ja),
  }));
  const first = normalized[0];
  if (!first) throw new Error("missing first candidate");
  const firstErrors = buildQualityErrors(context, first.reply_a_ja, first.reply_b_ja);
  if (firstErrors.length === 0) return { stage: "first", parsed: first, errors: [] as string[] };
  const second = normalized[1];
  if (!second) throw new Error("missing second candidate");
  const secondErrors = buildQualityErrors(context, second.reply_a_ja, second.reply_b_ja);
  if (secondErrors.length === 0) return { stage: "retry", parsed: second, errors: [] as string[] };
  const third = normalized[2];
  if (!third) throw new Error("missing third candidate");
  const thirdErrors = buildQualityErrors(context, third.reply_a_ja, third.reply_b_ja);
  if (thirdErrors.length === 0) return { stage: "repair", parsed: third, errors: [] as string[] };
  const facts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  const optionBridge = !!facts.is_reply_to_free_reading && !!facts.hit_cta_option;
  if (optionBridge && isBareCtaOptionReply(context)) {
    const fallback = buildBareOptionSafeFallback(context);
    const fallbackErrors = buildQualityErrors(context, fallback.reply_a_ja, fallback.reply_b_ja);
    if (fallbackErrors.length === 0) return { stage: "fallback", parsed: fallback, errors: [] as string[] };
    return { stage: "failed", parsed: fallback, errors: fallbackErrors };
  }
  return { stage: "failed", parsed: third, errors: thirdErrors };
}

function endsWithBareIkaga(text: string) {
  const t = String(text || "").trim();
  return /いかがですか[？?]?$/.test(t);
}

function getCurrentCustomerTurnJoinedText(context: Record<string, unknown>) {
  const turn = (context.current_customer_turn as Record<string, unknown> | undefined) || {};
  const joined = String(turn.joined_text || "").trim();
  if (joined) return joined;
  const messages = Array.isArray(turn.messages) ? turn.messages : [];
  const texts = messages
    .map((m) => {
      const mm = (m as Record<string, unknown>) || {};
      return String(mm.text || "").trim();
    })
    .filter(Boolean);
  return texts.join("\n").trim();
}

function isDetailRequestAfterFreeReading(context: Record<string, unknown>) {
  const text = getCurrentCustomerTurnJoinedText(context);
  if (!text) return false;
  return containsAny(text, ["詳しく", "内容", "教えて", "お願い", "見たい", "知りたい", "その先", "進めたい"]);
}

function isBareCtaOptionReply(context: Record<string, unknown>) {
  const facts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  if (!facts.is_reply_to_free_reading || !facts.hit_cta_option) return false;
  const selected = String(facts.selected_cta_option || "").trim();
  if (!selected) return false;
  if (isDetailRequestAfterFreeReading(context)) return false;
  return true;
}

function hasConcreteValueHook(text: string) {
  return containsAny(text, [
    "どこから",
    "どこで",
    "どう守る",
    "どう整える",
    "安心に繋がる",
    "動きやすい",
    "気持ちの向き方",
    "どう見ている",
    "友達として",
    "少し意識",
    "距離をどう",
    "生活の土台",
    "本音を詳しく",
  ]);
}

function areAlmostSame(a: string, b: string) {
  const na = String(a || "").replace(/\s+/g, "");
  const nb = String(b || "").replace(/\s+/g, "");
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  return shorter.length / longer.length >= 0.88 && longer.includes(shorter.slice(0, Math.min(18, shorter.length)));
}

function buildQualityErrors(context: Record<string, unknown>, replyA: string, replyB: string) {
  const errors: string[] = [];
  if (countBubbleMarkers(replyA) > 3) errors.push("reply_a_ja exceeds 3 bubbles");
  if (countBubbleMarkers(replyB) > 3) errors.push("reply_b_ja exceeds 3 bubbles");
  if (hasMultipleParagraphsWithoutBubbleMarkers(replyA) || hasMultipleParagraphsWithoutBubbleMarkers(replyB)) {
    errors.push("multiple bubbles must use ①②③ markers");
  }
  if (areAlmostSame(replyA, replyB)) errors.push("A/B are too similar");
  if (looksReportLike(replyA) || looksReportLike(replyB)) errors.push("reply looks too long/report-like");
  if (/(以下|分析|理由|差分|A案|B案|解説)/.test(`${replyA}\n${replyB}`)) errors.push("contains internal-analysis style text");
  const facts = (context.objective_facts as Record<string, unknown> | undefined) || {};
  const isOptionBridgeScenario = !!facts.is_reply_to_free_reading && !!facts.hit_cta_option;
  if (isOptionBridgeScenario) {
    const bareOptionReply = isBareCtaOptionReply(context);
    const detailRequestReply = isDetailRequestAfterFreeReading(context);
    const aWaitOnlyWithoutBridge = looksLikeWaitOnlyWithoutBridge(replyA);
    const bWaitOnlyWithoutBridge = looksLikeWaitOnlyWithoutBridge(replyB);
    if (aWaitOnlyWithoutBridge && bWaitOnlyWithoutBridge) {
      errors.push("option-reply branch cannot be wait-only in both A/B");
    }
    const aHasBoundary = hasBoundarySemantic(replyA);
    const bHasBoundary = hasBoundarySemantic(replyB);
    const aHasGuidance = hasGuidanceSemantic(replyA);
    const bHasGuidance = hasGuidanceSemantic(replyB);
    const aHasBridgeLite = containsAny(replyA, ["無料", "個別", "鑑定"]);
    const bHasBridgeLite = containsAny(replyB, ["無料", "個別", "鑑定"]);
    const hasCompleteBridgeInAtLeastOneVersion =
      (aHasBoundary && aHasGuidance) || (bHasBoundary && bHasGuidance) || aHasBridgeLite || bHasBridgeLite;
    const bareOptionBridgeOkay = bareOptionReply && (aHasBridgeLite || bHasBridgeLite);
    if (!hasCompleteBridgeInAtLeastOneVersion && !bareOptionBridgeOkay) {
      errors.push("option-reply branch requires both boundary and guidance semantics in at least one version");
    }
    if (aWaitOnlyWithoutBridge && !(bHasBoundary && bHasGuidance)) {
      errors.push("if A is wait-only, B must provide complete paid-bridge semantics");
    }
    if (bWaitOnlyWithoutBridge && !(aHasBoundary && aHasGuidance)) {
      errors.push("if B is wait-only, A must provide complete paid-bridge semantics");
    }
    const bridgeContext = (context.post_free_reading_bridge_context as Record<string, unknown> | undefined) || {};
    const painAnchors = Array.isArray(bridgeContext.pain_anchors)
      ? bridgeContext.pain_anchors.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    if (painAnchors.length > 0) {
      const aHasPainAnchor = hasPainAnchorOrSynonym(replyA, painAnchors);
      const bHasPainAnchor = hasPainAnchorOrSynonym(replyB, painAnchors);
      if (!aHasPainAnchor && !bHasPainAnchor) {
        errors.push("option bridge reply must reference customer-specific pain/background");
      }
    }
    const bHasNextStepEntrance = hasNextStepEntrance(replyB) || containsAny(replyB, ["必要でしたら", "このまま", "お願いします", "見てみたい場合"]);
    if (!bareOptionReply && !bHasNextStepEntrance) {
      errors.push("B should open clearer next-step entrance in option bridge scenario");
    }
    const bHasConversationBaton = hasConversationBaton(replyB) || containsAny(replyB, ["お願いします", "大丈夫です", "見てみたい場合", "このまま"]);
    if (!bareOptionReply && detailRequestReply && !bHasConversationBaton) {
      errors.push("B should include a light conversation baton in option bridge scenario");
    }
    if (bareOptionReply && (hasBareOptionNextStepEntrance(replyA) || hasBareOptionNextStepEntrance(replyB))) {
      errors.push("bare option reply should not open next-step entrance yet");
    }
    const aHasRoleCoverage = hasBareOptionRoleCoverage(replyA, context);
    const bHasRoleCoverage = hasBareOptionRoleCoverage(replyB, context);
    if (bareOptionReply && !aHasRoleCoverage && !bHasRoleCoverage) {
      errors.push("bare option reply must cover acceptance, customer-specific connection, and individual-deep-reading value");
    }
    if (bareOptionReply && !hasIndividualDeepValueSemantic(replyA) && !hasIndividualDeepValueSemantic(replyB)) {
      errors.push("bare option reply should seed individual deep-reading value, not only empathize");
    }
    if (bareOptionReply && !hasConcreteValueHook(replyA) && !hasConcreteValueHook(replyB)) {
      errors.push("bare option value seed should include a concrete curiosity hook");
    }
    if (
      bareOptionReply &&
      containsAny(replyB, ["見てみたい場合は「お願いします」だけで大丈夫です", "「お願いします」だけで大丈夫です", "お願いしますだけで大丈夫です"])
    ) {
      errors.push("bare option reply should not use strong reply-cue baton yet");
    }
    if (bareOptionReply && hasPaidEntranceCue(replyA)) {
      errors.push("A should stay lower-pressure; reserve clear paid-reading entrance mainly for B");
    }
    if (bareOptionReply && hasPaidEntranceCue(replyB) && !bHasRoleCoverage) {
      errors.push(
        "B paid-reading entrance requires acceptance, customer-specific connection, and individual-deep-reading value first",
      );
    }
    if (replyA.replace(/\s+/g, "").length > 240 || replyB.replace(/\s+/g, "").length > 240) {
      errors.push("option bridge reply is too long");
    }
    if (isThreeBubbleAndTooLong(replyA) || isThreeBubbleAndTooLong(replyB)) {
      errors.push("three-bubble option bridge reply must stay very short");
    }
    if (hasTooLongBubbleInOptionScenario(replyA) || hasTooLongBubbleInOptionScenario(replyB)) {
      errors.push("bubble is too long for LINE option bridge");
    }
    if (hasClearEntrancePhrase(replyA) && hasClearEntrancePhrase(replyB)) {
      errors.push("A should stay lower-pressure; reserve clear entrance mainly for B");
    }
    if (hasServiceyPhrase(replyA) || hasServiceyPhrase(replyB)) {
      errors.push("option bridge reply sounds too service-explanatory");
    }
    if (looksTooAbstractReadingServiceLike(replyA) || looksTooAbstractReadingServiceLike(replyB)) {
      errors.push("reply sounds too abstract / reading-service-like; ground it in customer-specific context");
    }
    if (endsWithBareIkaga(replyA) || endsWithBareIkaga(replyB) || /ご案内できますが、いかがですか[？?]?/.test(`${replyA}\n${replyB}`)) {
      errors.push("option bridge reply sounds too service-explanatory");
    }
  }
  return errors;
}

export const __testOnly = {
  buildQualityErrors,
  buildHardQualityErrors,
  buildModelContext,
  isBareCtaOptionReply,
  isDetailRequestAfterFreeReading,
  normalizeBubbleSpacing,
  hasBareOptionRoleCoverage,
  collectScenarioDebug,
  buildFinalRepairInstruction,
  buildBareOptionSafeFallback,
  recoverRepliesFromCandidates,
  withSan,
};

export async function runReplyGeneration(context: Record<string, unknown>) {
  const apiKey = process.env.EKAN8_API_KEY || process.env.AI_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL || process.env.AI_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL || process.env.AI_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL || process.env.AI_MAIN_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("generation service missing env");
  }

  buildChatCompletionsUrl({ baseOrEndpoint: baseUrl, preferEnvEndpoint: true });
  if (backupBaseUrl) {
    buildChatCompletionsUrl({ baseOrEndpoint: backupBaseUrl, preferEnvEndpoint: false });
  }

  const strategy = resolveGenerationStrategy();
  const debugEnabled = process.env.GENERATE_REPLIES_DEBUG_SCENARIO === "1";
  const scenarioDebug = collectScenarioDebug(context);
  const modelContext = buildModelContext(context);
  if (debugEnabled) {
    console.info("[reply-generation][scenario-debug]", JSON.stringify(scenarioDebug));
  }

  const askOnce = async (extraInstruction = "") => {
    const system = extraInstruction
      ? `${replyGenerationPrompt.system}\n\nSelf-fix instruction:\n${extraInstruction}`
      : replyGenerationPrompt.system;
    return requestStructuredJsonWithContract({
      apiKey,
      baseUrl,
      backupBaseUrl,
      model,
      system,
      user: JSON.stringify(modelContext, null, 2),
      temperature: strategy.temperature,
      stage: "generation",
      schemaName: "main_brain_reply_generation_result",
      schema: GENERATION_JSON_SCHEMA as unknown as Record<string, unknown>,
      validateParsed: validateGenerationContract,
    });
  };

  let response = await askOnce();
  let parsed = validateMainBrainGenerationResult(normalizeGenerationReply(response.parsed));
  parsed = {
    reply_a_ja: normalizeBubbleSpacing(parsed.reply_a_ja),
    reply_b_ja: normalizeBubbleSpacing(parsed.reply_b_ja),
  };
  let hardErrors = buildHardQualityErrors(context, parsed.reply_a_ja, parsed.reply_b_ja);
  if (debugEnabled) {
    console.info("[reply-generation][hard-quality-before-retry]", JSON.stringify({ hardErrors, parsed }));
  }
  let recoveryStage: "normal" | "retry" = "normal";

  if (hardErrors.length > 0) {
    response = await askOnce(
      `Your previous output failed basic hard checks: ${hardErrors.join(
        "; ",
      )}. Regenerate only clean Japanese LINE replies in valid JSON {reply_a_ja, reply_b_ja}. No Chinese. No metadata/explanations. Keep replies concise.`,
    );
    parsed = validateMainBrainGenerationResult(normalizeGenerationReply(response.parsed));
    parsed = {
      reply_a_ja: normalizeBubbleSpacing(parsed.reply_a_ja),
      reply_b_ja: normalizeBubbleSpacing(parsed.reply_b_ja),
    };
    hardErrors = buildHardQualityErrors(context, parsed.reply_a_ja, parsed.reply_b_ja);
    recoveryStage = "retry";
    if (debugEnabled) {
      console.info("[reply-generation][hard-quality-after-retry]", JSON.stringify({ hardErrors, parsed }));
    }
  }

  if (hardErrors.length > 0) {
    const error = new Error("生成结果未通过基础格式检查，请重新生成或人工填写。") as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    error.code = "generation_basic_quality_failed";
    error.details = {
      scenario_debug: scenarioDebug,
      hard_errors: hardErrors,
      recovery_stage: recoveryStage,
    };
    throw error;
  }

  return {
    ...response,
    model,
    promptVersion: replyGenerationPrompt.version,
    parsed,
    recoveryStage,
    debugMeta: {
      recovery_stage: recoveryStage,
      hard_errors: hardErrors,
    },
  };
}
