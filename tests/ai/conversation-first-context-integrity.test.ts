import test from "node:test";
import assert from "node:assert/strict";
import { __testOnly } from "../../lib/ai/reply-generation-service";

type Msg = {
  id: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  japaneseText: string;
  sentAt: string;
};

function payloadFrom(messages: Msg[], latestId: string, rewriteInput = "") {
  const latest = messages.find((m) => m.id === latestId);
  if (!latest) throw new Error(`missing latest id: ${latestId}`);
  return __testOnly.buildPromptPayload({
    rewriteInput,
    latestMessage: latest,
    recentMessages: messages,
  });
}

function assertCommonConversationFirst(payload: string) {
  assert.match(payload, /## 1\. システム上の役割・業務背景/);
  assert.match(payload, /## 8\. 出力ルール/);
  assert.match(payload, /【直前の運営メッセージ】/);
  assert.match(payload, /【今回返信すべき顧客メッセージ】/);
  assert.match(payload, /【今回だけの補足指示】/);
  assert.doesNotMatch(payload, /"stage":|"simple_context":|"selected_option":|"selected_cta_option":|"pain_anchors":|"bridge_meaning":|"post_free_option_reply_focus":/);
  assert.doesNotMatch(payload, /reply_a_ja|reply_b_ja/);
}

test("fixture 1: 初次接待 payload should include full history in asc order", () => {
  const messages: Msg[] = [
    { id: "c1", role: "CUSTOMER", type: "TEXT", japaneseText: "はじめまして。仕事とお金のことで悩んでいます。", sentAt: "2026-05-01T10:00:00.000Z" },
    { id: "o1", role: "OPERATOR", type: "TEXT", japaneseText: "ありがとうございます。まず全体の流れを軽く見ますね。", sentAt: "2026-05-01T10:01:00.000Z" },
    { id: "c2", role: "CUSTOMER", type: "TEXT", japaneseText: "お願いします。", sentAt: "2026-05-01T10:02:00.000Z" },
  ];
  const payload = payloadFrom(messages, "c2");
  assertCommonConversationFirst(payload);
  const i1 = payload.indexOf("はじめまして。仕事とお金のことで悩んでいます。");
  const i2 = payload.indexOf("まず全体の流れを軽く見ますね。");
  const i3 = payload.indexOf("お願いします。");
  assert.equal(i1 < i2 && i2 < i3, true);
  assert.match(payload, /【直前の運営メッセージ】[\s\S]*まず全体の流れを軽く見ますね。/);
});

test("fixture 2: 無料鑑定文後の選択肢返信 should preserve free reading body", () => {
  const messages: Msg[] = [
    { id: "c1", role: "CUSTOMER", type: "TEXT", japaneseText: "彼の気持ちが知りたいです。", sentAt: "2026-05-01T10:00:00.000Z" },
    {
      id: "o1",
      role: "OPERATOR",
      type: "TEXT",
      japaneseText:
        "【無料鑑定文】全体を見ると、連絡の流れは切れていません。ただ核心は、彼が今どの場面で慎重になっているかです。",
      sentAt: "2026-05-01T10:05:00.000Z",
    },
    { id: "c2", role: "CUSTOMER", type: "TEXT", japaneseText: "御縁の相手", sentAt: "2026-05-01T10:06:00.000Z" },
  ];
  const payload = payloadFrom(messages, "c2");
  assertCommonConversationFirst(payload);
  assert.match(payload, /【無料鑑定文】全体を見ると/);
  assert.match(payload, /御縁の相手/);
});

test("fixture 3: 詳しく見方質問 should keep current customer multi-bubble turn", () => {
  const messages: Msg[] = [
    { id: "o1", role: "OPERATOR", type: "TEXT", japaneseText: "気になる点があれば教えてください。", sentAt: "2026-05-01T10:00:00.000Z" },
    { id: "c1", role: "CUSTOMER", type: "TEXT", japaneseText: "はい", sentAt: "2026-05-01T10:01:00.000Z" },
    { id: "c2", role: "CUSTOMER", type: "TEXT", japaneseText: "写真送ります", sentAt: "2026-05-01T10:02:00.000Z" },
    { id: "c3", role: "CUSTOMER", type: "IMAGE", japaneseText: "", sentAt: "2026-05-01T10:03:00.000Z" },
    { id: "c4", role: "CUSTOMER", type: "TEXT", japaneseText: "どうやって詳しく見ていただけますか？", sentAt: "2026-05-01T10:04:00.000Z" },
  ];
  const payload = payloadFrom(messages, "c4");
  assertCommonConversationFirst(payload);
  assert.match(payload, /1\.\nはい/);
  assert.match(payload, /2\.\n写真送ります/);
  assert.match(payload, /3\.\n\[画像が送信されています\]/);
  assert.match(payload, /4\.\nどうやって詳しく見ていただけますか？/);
});

test("fixture 4: 料金質問 should keep quoted pricing message", () => {
  const messages: Msg[] = [
    { id: "o1", role: "OPERATOR", type: "TEXT", japaneseText: "詳しい見方もできます。", sentAt: "2026-05-01T10:00:00.000Z" },
    { id: "c1", role: "CUSTOMER", type: "TEXT", japaneseText: "料金はいくらですか？", sentAt: "2026-05-01T10:01:00.000Z" },
    { id: "o2", role: "OPERATOR", type: "TEXT", japaneseText: "【竹】4,980円 / 【松】9,980円 でご案内しています。", sentAt: "2026-05-01T10:02:00.000Z" },
    { id: "c2", role: "CUSTOMER", type: "TEXT", japaneseText: "ありがとうございます。", sentAt: "2026-05-01T10:03:00.000Z" },
  ];
  const payload = payloadFrom(messages, "c2");
  assertCommonConversationFirst(payload);
  assert.match(payload, /【竹】4,980円 \/ 【松】9,980円/);
  assert.match(payload, /【直前の運営メッセージ】\s+【竹】4,980円 \/ 【松】9,980円 でご案内しています。/s);
});

test("fixture 5: 支払い後 and operator note should keep payment confirmation and raw note", () => {
  const messages: Msg[] = [
    { id: "o1", role: "OPERATOR", type: "TEXT", japaneseText: "決済後に確認してご案内します。", sentAt: "2026-05-01T10:00:00.000Z" },
    { id: "c1", role: "CUSTOMER", type: "TEXT", japaneseText: "支払いました。", sentAt: "2026-05-01T10:01:00.000Z" },
    { id: "c2", role: "CUSTOMER", type: "STICKER", japaneseText: "", sentAt: "2026-05-01T10:02:00.000Z" },
  ];
  const note = "请更温柔一点\nでも短く";
  const payload = payloadFrom(messages, "c2", note);
  assertCommonConversationFirst(payload);
  assert.match(payload, /支払いました。/);
  assert.match(payload, /\[スタンプが送信されています\]/);
  assert.match(payload, /请更温柔一点/);
  assert.match(payload, /でも短く/);
});
