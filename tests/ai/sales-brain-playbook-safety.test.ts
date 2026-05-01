import test from "node:test";
import assert from "node:assert/strict";
import { salesBrainPlaybook } from "../../lib/ai/sales-brain-playbook";

function joinedPlaybook() {
  return [
    ...salesBrainPlaybook.identity,
    ...salesBrainPlaybook.product_model,
    ...salesBrainPlaybook.chat_turn_rhythm,
    ...salesBrainPlaybook.free_reading_bridge_rules,
    ...salesBrainPlaybook.stage_progression,
    ...salesBrainPlaybook.goal_priority,
    ...salesBrainPlaybook.sales_direction_guardrails,
    ...salesBrainPlaybook.pricing_rules,
    ...salesBrainPlaybook.post_purchase_rules,
    ...salesBrainPlaybook.objection_principles,
    ...salesBrainPlaybook.hard_boundaries,
    ...salesBrainPlaybook.output_requirements,
  ].join("\n");
}

test("sales brain should contain core conversion guardrails", () => {
  const text = joinedPlaybook();
  assert.match(text, /人間主導の日本LINE個別チャット成約システム/);
  assert.match(text, /深く見る価値のある問題層/);
  assert.match(text, /見積りはメニュー投げではない/);
  assert.match(text, /Take \+ Matsu/);
  assert.match(text, /Ume.*隠し軽量枠/);
  assert.match(text, /同じ第一層を売り直さない/);
  assert.match(text, /迷いが出た時/);
  assert.match(text, /長期成約と継続相談の導線を守る/);
  assert.equal(text.includes("復購導線"), false);
});
