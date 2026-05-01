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
  type: "TEXT" | "IMAGE" | "STICKER";
  text: string;
  sent_at_iso: string;
};

type PostFreeOptionReplyFocus = {
  stage_focus: "post_free_option_reply";
  reply_goal: string;
  selected_option: string;
  customer_voice_snippets: string[];
  concrete_connection_hint: string;
  must_do: string[];
  avoid: string[];
};

function looksInternalDisplayName(value: string) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/\d{2,4}[./-]\d{1,2}[./-]\d{1,2}/.test(text)) return true;
  if (/\d{1,2}[./-]\d{1,2}/.test(text)) return true;
  if (/^\d+[.)]/.test(text)) return true;
  return false;
}

function sanitizeReplyName(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (looksInternalDisplayName(text)) return "";
  if (/[0-9０-９]/.test(text)) return "";
  return text.slice(0, 20);
}

function withSanForSelfReportedName(name: string) {
  const value = sanitizeReplyName(name);
  if (!value) return "";
  if (/(さん|様|先生)$/.test(value)) return value;
  return `${value}さん`;
}

function extractSelfReportedCustomerName(messagesAsc: ContextMessage[]) {
  const customerTexts = messagesAsc
    .filter((item) => item.role === "CUSTOMER" && item.type === "TEXT")
    .slice(0, 12)
    .map((item) => String(item.japaneseText || "").trim())
    .filter(Boolean);

  for (const text of customerTexts) {
    const inline = text.match(/[①➀]\s*([^\s②③④⑤⑥⑦⑧⑨⑩、。,:：]{1,20})/);
    if (inline?.[1]) {
      const name = sanitizeReplyName(inline[1]);
      if (name) return name;
    }
    const labeled = text.match(/(?:名前|お名前)\s*[:：]?\s*([^\s、。,:：]{1,20})/);
    if (labeled?.[1]) {
      const name = sanitizeReplyName(labeled[1]);
      if (name) return name;
    }
  }
  return "";
}

function deriveSimpleStage(input: {
  objectiveFacts: ReturnType<typeof deriveObjectiveSalesFacts>;
  currentCustomerTurnJoinedText: string;
}) {
  const facts = input.objectiveFacts;
  const turnText = String(input.currentCustomerTurnJoinedText || "");
  if (facts.is_reply_to_free_reading && /詳しく|内容|お願いします|お願い|見てほしい|教えてください|知りたい/.test(turnText)) {
    return "detail_request_after_free";
  }
  if (facts.has_paid_order) return "paid_followup";
  if (facts.is_reply_to_free_reading && facts.hit_cta_option && facts.selected_cta_option) {
    return "post_free_option_reply";
  }
  if (/料金|支払い|決済|見積|振込|カード|paypal/i.test(turnText)) return "pricing_or_payment";
  if (facts.has_explicit_objection || facts.has_explicit_rejection || /高い|迷う|不安|無理|断る/.test(turnText)) {
    return "hesitation_or_objection";
  }
  if (facts.is_initial_reception_phase) return "initial_consultation_ack";
  if (/ありがとう|了解|よろしく/.test(turnText)) return "general_chat";
  return "general_chat";
}

function containsLikelyChineseInstruction(text: string) {
  const value = String(text || "").trim();
  if (!value) return false;
  // Avoid broad CJK checks; look for explicit Chinese markers and punctuation patterns.
  return /[，。；：！？]|(不要|中文|翻译|更销售|别太客气|语气|长度|推进|改成|请用)/.test(value);
}

function normalizeRewriteRequirement(input: string) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (!containsLikelyChineseInstruction(value)) return value;
  // TODO: Chinese rewriteInput should be translated to Japanese operator instruction by translation model before entering reply generation context.
  return "運営者の追加要望: もう少し成約方向に進める。ただし押し売りにせず、丁寧すぎない自然なLINE文体に調整する。";
}

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

function buildTimeToneHint(minutesSinceLastCustomerMessage: number | null) {
  if (minutesSinceLastCustomerMessage == null) return "Timing unknown; keep tone natural and avoid heavy waiting/apology phrasing.";
  if (minutesSinceLastCustomerMessage <= 5) {
    return "Latest customer message is recent (within 5 minutes). Reply in immediate-chat tone; avoid 'お待たせしました'.";
  }
  if (minutesSinceLastCustomerMessage <= 180) {
    return "Latest customer message is from within a few hours. Keep natural reconnection; avoid heavy apology.";
  }
  if (minutesSinceLastCustomerMessage <= 24 * 60) {
    return "Latest customer message is from earlier today/yesterday. Light reconnect phrasing is acceptable.";
  }
  return "Latest customer message is from multiple days ago. Add a short natural reconnection cue before progressing.";
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
  targetMessageId?: string | null;
}) {
  const targetIndex = input.targetMessageId
    ? input.orderedMessages.findIndex((item) => item.id === input.targetMessageId)
    : -1;
  const cappedIndex = targetIndex >= 0 ? targetIndex : input.orderedMessages.length - 1;
  const bounded = input.orderedMessages.slice(0, Math.max(0, cappedIndex) + 1);

  let boundaryIndex = -1;
  for (let i = bounded.length - 1; i >= 0; i -= 1) {
    const candidate = bounded[i];
    if (input.targetMessageId && candidate.id === input.targetMessageId) continue;
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
      type: item.type,
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
    text_messages: turnCustomerMessages.filter((item) => item.type === "TEXT"),
    non_text_messages: turnCustomerMessages.filter((item) => item.type !== "TEXT"),
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

function sanitizeLongTermJapaneseField(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (containsLikelyChineseInstruction(text)) return "";
  return text;
}

function extractEarlyCustomerWords(ordered: ContextMessage[], max = 8) {
  const result = ordered
    .filter((m) => m.role === "CUSTOMER" && m.type === "TEXT")
    .slice(0, max)
    .map((m) => String(m.japaneseText || "").trim())
    .filter(Boolean);
  return Array.from(new Set(result));
}

function pickOriginalCustomerWords(words: string[]) {
  const scored = words
    .map((w) => {
      let score = 0;
      if (/(現状|どうすれば|どおすれば|悩み|不安|金銭|お金|生活|子供|子ども|未来|笑って|本音|距離|付き合)/.test(w)) score += 2;
      if (w.length >= 12) score += 1;
      return { w, score };
    })
    .sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 3).map((x) => x.w);
  return picked.length > 0 ? picked : words.slice(0, 2);
}

function extractPainAnchors(input: { selectedOption: string; originalWords: string[]; keyMessage: string }) {
  const joined = [input.selectedOption, ...input.originalWords, input.keyMessage].join("\n");
  const anchors: string[] = [];
  const push = (v: string) => {
    if (v && !anchors.includes(v)) anchors.push(v);
  };
  if (/(金銭|お金|収入|支出)/.test(joined)) push("金銭面");
  if (/(子供|子ども|お子さん)/.test(joined)) push("子供達");
  if (/(笑って|笑顔|未来)/.test(joined)) push("笑ってすごせる未来");
  if (/(生活|安心)/.test(joined)) push("生活の安心");
  if (/(本音)/.test(joined)) push("相手の本音");
  if (/(距離|縮め)/.test(joined)) push("距離の縮め方");
  if (/(付き合)/.test(joined)) push("付き合える流れ");
  return anchors.slice(0, 6);
}

function buildBridgeMeaning(selectedOption: string, anchors: string[]) {
  if (anchors.length >= 2) {
    return `顧客は「${selectedOption}」を通じて、「${anchors[0]}」と「${anchors[1]}」に関わる不安を深く確認したい状態。`;
  }
  if (anchors.length === 1) {
    return `顧客は「${selectedOption}」を通じて、「${anchors[0]}」に関わる不安を深く確認したい状態。`;
  }
  return `顧客は「${selectedOption}」を、無料範囲を超える個別の問題層として深く見たい状態。`;
}

function splitJapanesePhrases(text: string) {
  return String(text || "")
    .split(/[。！？!?、,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isSnippetNoise(text: string) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^\d{1,4}([./-]\d{1,2}){1,2}$/.test(t)) return true;
  if (/^[①-⑩➀-➉0-9０-９()\s]+$/.test(t)) return true;
  if (/^(名前|お名前|生年月日|現在のお悩み|理想の未来|よろしくお願いします?)$/.test(t)) return true;
  if (t.length < 4) return true;
  return false;
}

function normalizeSnippet(text: string) {
  return String(text || "")
    .replace(/[「」『』【】]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasConcreteTopic(text: string) {
  return /(借金|返済|金銭|お金|生活|仕事|収入|支出|転職|本音|相手|テツ|距離|気持ち|付き合|不安|未来|安心)/.test(text);
}

function buildCustomerVoiceSnippets(input: { selectedOption: string; originalWords: string[] }) {
  const pool = [input.selectedOption, ...input.originalWords];
  const snippets: string[] = [];
  for (const source of pool) {
    const parts = splitJapanesePhrases(source);
    for (const p of parts) {
      const s = normalizeSnippet(p);
      if (isSnippetNoise(s)) continue;
      if (!hasConcreteTopic(s) && s.length < 8) continue;
      if (s.length > 40) continue;
      if (!snippets.includes(s)) snippets.push(s);
      if (snippets.length >= 4) return snippets;
    }
  }
  return snippets.slice(0, 4);
}

function buildConcreteConnectionHint(input: {
  selectedOption: string;
  snippets: string[];
  bridgeMeaning: string;
}) {
  const selected = String(input.selectedOption || "").trim();
  const snippets = input.snippets.slice(0, 2).join(" / ");
  const bridge = String(input.bridgeMeaning || "").trim();
  const hasTemplate = /深く確認したい状態/.test(bridge);

  if (snippets && /(借金|返済|金銭|お金|生活)/.test(`${selected} ${snippets}`)) {
    return `「${selected}」は、${snippets}の不安や、どこから立て直せばいいかという迷いにつながっている部分。`;
  }
  if (snippets && /(本音|相手|テツ|距離|気持ち|付き合)/.test(`${selected} ${snippets}`)) {
    return `「${selected}」は、${snippets}が見えないことで、距離の取り方や次の動き方に迷いやすい部分につながっている。`;
  }
  if (bridge && !hasTemplate) {
    return bridge;
  }
  if (snippets) {
    return `「${selected}」は、${snippets}に関わる不安や願いとつながっている部分。`;
  }
  return `「${selected}」は、顧客の今の不安や願いにつながっている部分。`;
}

function buildPostFreeOptionReplyFocus(input: {
  stage: string;
  selectedOption: string | null;
  originalConsultation: string[];
  bridgeMeaning: string;
}): PostFreeOptionReplyFocus | null {
  if (input.stage !== "post_free_option_reply") return null;
  const selectedOption = String(input.selectedOption || "").trim();
  if (!selectedOption) return null;
  const customerVoiceSnippets = buildCustomerVoiceSnippets({
    selectedOption,
    originalWords: input.originalConsultation,
  });
  return {
    stage_focus: "post_free_option_reply",
    reply_goal:
      "選択肢を受け止め、顧客の原文の痛みへ戻し、無料の表面では足りない理由を短く示し、Bだけ低圧に詳しい鑑定入口を開く",
    selected_option: selectedOption,
    customer_voice_snippets: customerVoiceSnippets,
    concrete_connection_hint: buildConcreteConnectionHint({
      selectedOption,
      snippets: customerVoiceSnippets,
      bridgeMeaning: input.bridgeMeaning,
    }),
    must_do: [
      "選択肢を短く受け止める",
      "customer_voice_snippets のうち1つか2つを自然に使う",
      "一般論ではなく顧客本人の話に戻す",
      "無料鑑定の表面だけでは足りない理由を短く示す",
      "Aは低圧、Bは少し明確に詳しい鑑定入口を開く",
    ],
    avoid: [
      "初回接待のように短く終わる",
      "説明文だけで終わる",
      "抽象語だけで終わる",
      "料金案内に進む",
      "顧客の原文にない要素を勝手に足す",
    ],
  };
}

function buildBusinessPosition(input: {
  isInitialReceptionPhase: boolean;
  isReplyToFreeReading: boolean;
  hasPaidOrder: boolean;
}) {
  if (input.hasPaidOrder) {
    return "現在位置: 支払い後フォロー段階。現在の有料フロー継続・不明点整理・信頼維持を優先する。";
  }
  if (input.isReplyToFreeReading) {
    return "現在位置: 無料鑑定文後フォロー段階。顧客は無料鑑定文への返信中で、まだ未決済。";
  }
  if (input.isInitialReceptionPhase) {
    return "現在位置: 初回受付段階。顧客は相談内容を送信済みで、無料鑑定前の最初の自然な受け止めを待っている。";
  }
  return "現在位置: 未決済の通常チャット進行段階。自然な往復で一歩ずつ前進する。";
}

function buildSalesDirection(input: {
  isInitialReceptionPhase: boolean;
  isReplyToFreeReading: boolean;
  hitCtaOption: boolean;
  hasPaidOrder: boolean;
}) {
  if (input.hasPaidOrder) {
    return "販売方向: 有料段階の体験を安定させ、現在の不安や質問に対応する。無料段階の売り直しはしない。";
  }
  if (input.isInitialReceptionPhase) {
    return "現在シーン: 相談内容送信直後の初回受付。まず最も痛い点を受け止め、きちんと読まれている実感を作る。重要情報が欠ける場合を除き追加質問を増やさない。ここで販売・見積り・正式鑑定文作成はしない。共有内容をもとに、まず流れを見ていく旨で自然に無料鑑定方向へつなぐ。";
  }
  if (input.isReplyToFreeReading && input.hitCtaOption) {
    return "販売方向: 顧客の関心窓口が開いている。選択された論点を軸に、半歩〜一歩だけ前進する。";
  }
  if (input.isReplyToFreeReading) {
    return "販売方向: 無料鑑定文後の継続会話。会話の自然さを保ち、いきなり大きく詰めずに穏やかに前進する。";
  }
  return "販売方向: current_customer_turn を自然に受け止め、窓口が明確な時に一歩だけ前へ進める。";
}

export function buildMainBrainGenerationContext(input: {
  customer: {
    id: string;
    stage: string;
    display_name: string;
    ai_customer_info?: string | null;
    ai_current_strategy?: string | null;
    risk_tags?: string[] | null;
    followup?: {
      bucket?: string | null;
      tier?: string | null;
      state?: string | null;
      reason?: string | null;
      next_followup_at?: string | null;
    } | null;
    tags?: string[] | null;
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
    targetMessageId: input.latestMessage.id || null,
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
  const currentTurnLastMessageMs = toMs(currentCustomerTurn.latest_sent_at) || latestMessageMs;
  const minutesSinceLastCustomerMessage = Math.max(0, Math.round((Date.now() - currentTurnLastMessageMs) / 60000));
  const latestOperatorMessage =
    [...ordered]
      .filter((item) => item.role === "OPERATOR")
      .sort((a, b) => (toMs(b.sentAt) || 0) - (toMs(a.sentAt) || 0))[0] || null;
  const latestOperatorTextMessage =
    [...ordered]
      .filter((item) => item.role === "OPERATOR" && item.type === "TEXT" && String(item.japaneseText || "").trim())
      .sort((a, b) => (toMs(b.sentAt) || 0) - (toMs(a.sentAt) || 0))[0] || null;
  const previousMessage =
    [...ordered]
      .filter((item) => item.id !== input.latestMessage.id)
      .sort((a, b) => (toMs(b.sentAt) || 0) - (toMs(a.sentAt) || 0))[0] || null;
  const previousMessageMs = toMs(previousMessage?.sentAt);
  const postFreeReadingBridgeContext =
    objectiveFacts.is_reply_to_free_reading && objectiveFacts.hit_cta_option && objectiveFacts.selected_cta_option
      ? (() => {
          const selectedOption = String(objectiveFacts.selected_cta_option || "").trim();
          const earlyWords = extractEarlyCustomerWords(ordered);
          const originalWords = pickOriginalCustomerWords(earlyWords);
          const keyMessageText = String(objectiveFacts.key_operator_long_message?.japanese_text || "");
          const painAnchors = extractPainAnchors({
            selectedOption,
            originalWords,
            keyMessage: keyMessageText,
          });
          return {
            selected_option: selectedOption,
            original_customer_words: originalWords,
            pain_anchors: painAnchors,
            bridge_meaning: buildBridgeMeaning(selectedOption, painAnchors),
            recommended_reply_shape: [
              "選択肢を受け止める",
              "選択肢を顧客の最初の痛み・背景・願望に接続する",
              "無料の範囲を超えるため個別鑑定へ橋渡しする",
            ],
          };
        })()
      : null;

  const selfReportedName = extractSelfReportedCustomerName(ordered);
  const simpleStage = deriveSimpleStage({
    objectiveFacts,
    currentCustomerTurnJoinedText: currentCustomerTurn.joined_text,
  });
  const timeGapHint =
    minutesSinceLastCustomerMessage <= 5
      ? "short"
      : minutesSinceLastCustomerMessage <= 180
        ? "medium"
        : "long";
  const simpleContext = {
    customer: {
      self_reported_name: selfReportedName,
      do_not_use_internal_display_name_in_reply: true,
    },
    stage: simpleStage,
    current_turn: {
      messages: currentCustomerTurn.messages.map((item) => item.text).filter(Boolean),
      time_gap_hint: timeGapHint,
    },
    conversation: {
      original_consultation: postFreeReadingBridgeContext?.original_customer_words || [],
      last_operator_message_type: objectiveFacts.is_reply_to_free_reading ? "free_reading" : "normal_chat",
      selected_option: postFreeReadingBridgeContext?.selected_option || null,
      pain_anchors: postFreeReadingBridgeContext?.pain_anchors || [],
      bridge_meaning: postFreeReadingBridgeContext?.bridge_meaning || "",
    },
    sales_goal:
      simpleStage === "post_free_option_reply"
        ? "初回有料鑑定への低圧橋渡し"
        : simpleStage === "detail_request_after_free"
          ? "顧客の詳述要望に沿って次の案内へ自然に進める"
          : "自然な関係維持と次の一歩の明確化",
    post_free_option_reply_focus: buildPostFreeOptionReplyFocus({
      stage: simpleStage,
      selectedOption: postFreeReadingBridgeContext?.selected_option || null,
      originalConsultation: postFreeReadingBridgeContext?.original_customer_words || [],
      bridgeMeaning: postFreeReadingBridgeContext?.bridge_meaning || "",
    }),
  };

  return {
    objective: "Generate two LINE-ready Japanese reply suggestions (A/B) for operator review, grounded in current_customer_turn.",
    timezone,
    assistant_role_sentence:
      "あなたは、成熟して柔らかい日本人女性鑑定師の語感で、1対1の関係構築型成約を補助するLINE返信作成AI。",
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
        "まず事実・価格/工程の境界・安全境界を優先する。",
        "次にチャットの往復リズムを守る。",
        "次に成約前進の不足を補う。",
        "最後に段階戦略の細部を調整する。",
      ],
      core_rules: [
        "latest_customer_message 単体ではなく、current_customer_turn 全体を1ターンとして返信する。",
        "複数ターン分の販売ステップを1通に圧縮しない。",
        "通常は半歩〜一歩だけ進める。",
        "顧客ターンが短い時は返信も短く自然にする。",
      ],
    },
    customer: {
      customer_id: input.customer.id,
      display_name: input.customer.display_name,
      self_reported_name: selfReportedName,
      internal_display_name: input.customer.display_name,
      do_not_use_internal_display_name_in_reply: true,
      stage: input.customer.stage,
      has_paid_order: objectiveFacts.has_paid_order,
    },
    stage: simpleStage,
    generation_clock: generationClock,
    timing_context: {
      now_iso: new Date().toISOString(),
      current_turn_latest_message_sent_at_iso: currentCustomerTurn.latest_sent_at,
      minutes_since_last_customer_message: minutesSinceLastCustomerMessage,
      tone_hint: buildTimeToneHint(minutesSinceLastCustomerMessage),
    },
    latest_customer_message: {
      role: "technical_target_last_message_of_current_turn",
      message_id: input.latestMessage.id,
      sent_at_iso: toIso(input.latestMessage.sentAt),
      japanese_text: input.latestMessage.japaneseText,
      minutes_since_previous_message:
        previousMessageMs == null ? null : Math.max(0, Math.round((latestMessageMs - previousMessageMs) / 60000)),
    },
    current_customer_turn: currentCustomerTurn,
    last_operator_message: latestOperatorMessage
      ? {
          id: latestOperatorMessage.id,
          type: latestOperatorMessage.type,
          sent_at_iso: toIso(latestOperatorMessage.sentAt),
          japanese_text: latestOperatorMessage.japaneseText || "",
        }
      : null,
    last_operator_text_message: latestOperatorTextMessage
      ? {
          id: latestOperatorTextMessage.id,
          sent_at_iso: toIso(latestOperatorTextMessage.sentAt),
          japanese_text: latestOperatorTextMessage.japaneseText || "",
        }
      : null,
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
    post_free_reading_bridge_context: postFreeReadingBridgeContext,
    customer_long_term_context: {
      ai_customer_info: sanitizeLongTermJapaneseField(input.customer.ai_customer_info),
      ai_current_strategy: sanitizeLongTermJapaneseField(input.customer.ai_current_strategy),
      risk_tags: Array.isArray(input.customer.risk_tags) ? input.customer.risk_tags : [],
      tags: Array.isArray(input.customer.tags) ? input.customer.tags : [],
      followup: input.customer.followup || null,
    },
    timeline: {
      message_window_size: timelineMessages.length,
      messages: timelineMessages,
    },
    sales_brain_playbook: salesBrainPlaybook,
    rewrite_requirement: normalizeRewriteRequirement(input.rewriteInput || ""),
    simple_context: simpleContext,
  };
}

export const __testOnly = {
  extractSelfReportedCustomerName,
  sanitizeReplyName,
  withSanForSelfReportedName,
  deriveSimpleStage,
};

