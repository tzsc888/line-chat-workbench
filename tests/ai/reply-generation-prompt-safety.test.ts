import test from "node:test";
import assert from "node:assert/strict";
import { FINAL_PROMPT_TEMPLATE } from "../../lib/ai/prompts/reply-generation";

test("final prompt should contain all 8 section titles", () => {
  const sections = [
    "## 1. システム上の役割・業務背景",
    "## 2. 接客・成約の考え方 + 内部判断順",
    "## 3. 料金表・料金案内ルール",
    "## 4. 現在時刻",
    "## 5. 実際のチャット履歴",
    "## 6. 直前の運営メッセージ + 今回返信すべき顧客メッセージ",
    "## 7. 禁止事項・絶対ルール",
    "## 8. 出力ルール",
  ];
  for (const section of sections) {
    assert.equal(FINAL_PROMPT_TEMPLATE.includes(section), true, `missing section: ${section}`);
  }
});

test("final prompt should contain all placeholders", () => {
  const placeholders = [
    "{{CURRENT_TIME_JST}}",
    "{{CHAT_HISTORY}}",
    "{{LAST_OPERATOR_MESSAGE}}",
    "{{CURRENT_MESSAGE_COUNT}}",
    "{{CURRENT_CUSTOMER_MESSAGES}}",
    "{{OPERATOR_NOTE_OPTIONAL}}",
  ];
  for (const token of placeholders) {
    assert.equal(FINAL_PROMPT_TEMPLATE.includes(token), true, `missing placeholder: ${token}`);
  }
});

test("final prompt should contain required restored labels and lines", () => {
  const mustHave = [
    "【生成返信前の内部判断】",
    "【竹】本格リーディング鑑定：4,980円",
    "【松】完全オーダーメイド鑑定：9,980円",
    "【梅】ミニ鑑定：2,980円",
    "初回の料金案内では、基本的に【竹】と【松】を同時に出してください。",
    "大多数の場合は【竹】を主におすすめします。",
    "顧客が明らかに複数のテーマ、全体の流れ、未来全体まで見たがっている時は【松】を自然にすすめてもよいです。",
    "【梅】は初回から自分で出さないでください。",
    "その後で【竹】と【松】を案内します。",
    "【直前の運営メッセージ】",
    "【今回返信すべき顧客メッセージ】",
    "【今回だけの補足指示】",
    "【竹】4,980円",
    "【松】9,980円",
    "【梅】2,980円",
  ];
  for (const token of mustHave) {
    assert.equal(FINAL_PROMPT_TEMPLATE.includes(token), true, `missing required token: ${token}`);
  }
});

test("final prompt should not contain broken phrases", () => {
  const broken = [
    "基本的にとを同時に",
    "大多数の場合はを主に",
    "その後でとを案内",
    "時はを自然にすすめ",
    "\nは初回から自分で出さないでください。",
  ];
  for (const token of broken) {
    assert.equal(FINAL_PROMPT_TEMPLATE.includes(token), false, `unexpected broken token: ${token}`);
  }
});

test("final prompt should use reply_ja only and avoid legacy fields", () => {
  assert.equal(FINAL_PROMPT_TEMPLATE.includes('"reply_ja": "..."'), true);
  assert.equal(/reply_a_ja|reply_b_ja/.test(FINAL_PROMPT_TEMPLATE), false);
  assert.equal(/simple_context|post_free_option_reply_focus|pain_anchors|bridge_meaning|selected_cta_option/.test(FINAL_PROMPT_TEMPLATE), false);
});
