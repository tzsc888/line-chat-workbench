import test from "node:test";
import assert from "node:assert/strict";
import { __testOnly } from "../../lib/ai/reply-generation-service";

test("payload should include restored labels and should not include broken phrases", () => {
  const payload = __testOnly.buildPromptPayload({
    rewriteInput: "語尾をやわらかく",
    latestMessage: {
      id: "m5",
      role: "CUSTOMER",
      type: "TEXT",
      japaneseText: "どうやって見ていただけますか？",
      sentAt: "2026-05-01T11:05:00.000Z",
    },
    recentMessages: [
      { id: "m1", role: "CUSTOMER", type: "TEXT", japaneseText: "無料鑑定ありがとうございます。", sentAt: "2026-05-01T11:00:00.000Z" },
      { id: "m2", role: "OPERATOR", type: "TEXT", japaneseText: "詳しく見る場合は個別鑑定の内容案内ができます。", sentAt: "2026-05-01T11:02:00.000Z" },
      { id: "m3", role: "CUSTOMER", type: "TEXT", japaneseText: "はい", sentAt: "2026-05-01T11:03:00.000Z" },
      { id: "m4", role: "CUSTOMER", type: "IMAGE", japaneseText: "", sentAt: "2026-05-01T11:04:00.000Z" },
      { id: "m5", role: "CUSTOMER", type: "TEXT", japaneseText: "どうやって見ていただけますか？", sentAt: "2026-05-01T11:05:00.000Z" },
    ],
  });

  const mustHave = [
    "【生成返信前の内部判断】",
    "【竹】本格リーディング鑑定：4,980円",
    "【松】完全オーダーメイド鑑定：9,980円",
    "【梅】ミニ鑑定：2,980円",
    "初回の料金案内では、基本的に【竹】と【松】を同時に出してください。",
    "その後で【竹】と【松】を案内します。",
    "【直前の運営メッセージ】",
    "【今回返信すべき顧客メッセージ】",
    "【今回だけの補足指示】",
    "【竹】4,980円",
    "【松】9,980円",
    "【梅】2,980円",
  ];

  for (const token of mustHave) {
    assert.equal(payload.includes(token), true, `payload missing token: ${token}`);
  }

  const broken = ["基本的にとを同時に", "大多数の場合はを主に", "その後でとを案内", "時はを自然にすすめ", "\nは初回から自分で出さないでください。"];
  for (const token of broken) {
    assert.equal(payload.includes(token), false, `payload unexpectedly includes broken token: ${token}`);
  }
});

test("payload should replace all placeholders", () => {
  const payload = __testOnly.buildPromptPayload({
    rewriteInput: "",
    latestMessage: {
      id: "m1",
      role: "CUSTOMER",
      type: "TEXT",
      japaneseText: "はい",
      sentAt: "2026-05-01T11:00:00.000Z",
    },
    recentMessages: [{ id: "m1", role: "CUSTOMER", type: "TEXT", japaneseText: "はい", sentAt: "2026-05-01T11:00:00.000Z" }],
  });

  assert.equal(payload.includes("{{CURRENT_TIME_JST}}"), false);
  assert.equal(payload.includes("{{CHAT_HISTORY}}"), false);
  assert.equal(payload.includes("{{LAST_OPERATOR_MESSAGE}}"), false);
  assert.equal(payload.includes("{{CURRENT_MESSAGE_COUNT}}"), false);
  assert.equal(payload.includes("{{CURRENT_CUSTOMER_MESSAGES}}"), false);
  assert.equal(payload.includes("{{OPERATOR_NOTE_OPTIONAL}}"), false);
});

test("chat history should keep role/time and non-text placeholders", () => {
  const payload = __testOnly.buildPromptPayload({
    rewriteInput: "",
    latestMessage: {
      id: "m6",
      role: "CUSTOMER",
      type: "STICKER",
      japaneseText: "",
      sentAt: "2026-05-01T11:06:00.000Z",
    },
    recentMessages: [
      { id: "m1", role: "CUSTOMER", type: "TEXT", japaneseText: "最初の相談です。", sentAt: "2026-05-01T11:00:00.000Z" },
      { id: "m2", role: "OPERATOR", type: "TEXT", japaneseText: "【無料鑑定文】全体の流れを見ました。", sentAt: "2026-05-01T11:01:00.000Z" },
      { id: "m3", role: "OPERATOR", type: "TEXT", japaneseText: "【料金案内】竹 4,980円 / 松 9,980円", sentAt: "2026-05-01T11:02:00.000Z" },
      { id: "m4", role: "CUSTOMER", type: "TEXT", japaneseText: "支払い確認ありがとうございます。", sentAt: "2026-05-01T11:03:00.000Z" },
      { id: "m5", role: "CUSTOMER", type: "IMAGE", japaneseText: "", sentAt: "2026-05-01T11:04:00.000Z" },
      { id: "m6", role: "CUSTOMER", type: "STICKER", japaneseText: "", sentAt: "2026-05-01T11:06:00.000Z" },
    ],
  });

  assert.equal(payload.includes("顧客：\n最初の相談です。"), true);
  assert.equal(payload.includes("運営：\n【無料鑑定文】全体の流れを見ました。"), true);
  assert.equal(payload.includes("[画像が送信されています]"), true);
  assert.equal(payload.includes("[スタンプが送信されています]"), true);
});
