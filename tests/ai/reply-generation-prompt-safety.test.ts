import test from "node:test";
import assert from "node:assert/strict";
import { replyGenerationPrompt } from "../../lib/ai/prompts/reply-generation";

test("prompt should include initial_consultation_ack guidance", () => {
  const s = replyGenerationPrompt.system;
  assert.match(s, /initial_consultation_ack/);
  assert.match(s, /まず全体の流れを軽く見てみます/);
  assert.match(s, /少しだけお待ちください/);
  assert.match(s, /正式な無料鑑定文を書かない/);

  const initialBlockMatch = s.match(
    /Example initial_consultation_ack 1:[\s\S]*?3\. detail_request_after_free:/,
  );
  assert.ok(initialBlockMatch);
  const initialBlock = initialBlockMatch![0];
  assert.equal(initialBlock.includes("詳しい鑑定の形でご案内できます"), false);
});

test("prompt should include detail_request_after_free guidance", () => {
  const s = replyGenerationPrompt.system;
  assert.match(s, /detail_request_after_free/);
  assert.match(s, /詳しい個別鑑定の範囲/);
  assert.match(s, /鑑定内容と進め方/);
  assert.match(s, /無料で詳細鑑定を続ける/);
});

test("prompt should include pricing_or_payment guidance and fixed prices", () => {
  const s = replyGenerationPrompt.system;
  assert.match(s, /pricing_or_payment/);
  assert.match(s, /【竹】本格リーディング鑑定/);
  assert.match(s, /【松】完全オーダーメイド鑑定/);
  assert.match(s, /【梅】ミニ鑑定/);
  assert.match(s, /初回の料金案内では【竹】と【松】を同時に出す/);
  assert.match(s, /基本は【竹】を主におすすめする/);
  assert.match(s, /【梅】は最初から提示しない/);
  assert.match(
    s,
    /【梅】は「高い」「予算が厳しい」「少し考える」など予算面の迷いが出た時に補助として出す/,
  );
  assert.match(s, /【竹希望】または【松希望】/);
  assert.match(s, /まずは【竹】がいちばん入りやすいです/);
  assert.match(s, /まず一番自然なのは【竹】です/);
  assert.match(s, /必要でしたら【竹希望】と送ってくださいね/);
  assert.match(s, /初回の料金案内では【梅】を出さない/);
});

test("prompt should not contain broken pricing phrases", () => {
  const s = replyGenerationPrompt.system;
  assert.equal(s.includes("初回の料金案内ではとを同時に出す"), false);
  assert.equal(s.includes("基本はを主におすすめする"), false);
  assert.equal(s.includes("時だけ寄りにしてよい"), false);
  assert.equal(/(^|\n)- は最初から提示しない/.test(s), false);
  assert.equal(s.includes("まずはがいちばん入りやすい"), false);
  assert.equal(s.includes("まず一番自然なのはです"), false);
  assert.equal(s.includes("必要でしたらと送ってください"), false);
  assert.equal(s.includes("または\nとだけ送ってくださいね"), false);
  assert.equal(s.includes("初回の料金案内ではを出さない"), false);
  assert.equal(/(^|\n)を出す時も、竹の方が深く見られることは低圧に伝える。/.test(s), false);
});

test("prompt should preserve mature post_free_option_reply section and few-shots", () => {
  const s = replyGenerationPrompt.system;
  assert.match(s, /post_free_option_reply/);
  assert.match(s, /ももさんがそこを選ばれたの/);
  assert.match(s, /必要でしたらこのまま詳しい鑑定の形でご案内できます/);
  assert.match(s, /相手の本音/);
  assert.match(s, /お二人の流れ/);
});

test("prompt should not contain mojibake markers or chinese-style residue words", () => {
  const s = replyGenerationPrompt.system;
  const mojibakeMarkers = [
    "\u9287",
    "\u942d",
    "\u7a7a",
    "\u9359",
    "\u7455",
    "\u704f",
    "\u4efe",
    "\uFFFD",
  ];
  assert.equal(mojibakeMarkers.some((marker) => s.includes(marker)), false);
  assert.equal(
    /客服|自填|痛点|报价|报价单|套餐|主推|主动提示|预算犹豫|推荐|付款確認|示例只适用于|承接|菜单/.test(
      s,
    ),
    false,
  );
});


test("prompt should include post_free_option_reply_focus token guidance", () => {
  const txt = replyGenerationPrompt.system;
  assert.match(txt, /post_free_option_reply_focus/);
});
