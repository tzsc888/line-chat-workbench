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
    /submitted consultation details|consultation details/i,
  );
  assert.match(
    context.sales_direction,
    /Do not ask for more details unless key information is clearly missing/i,
  );
  assert.match(
    context.sales_direction,
    /bridging to the free-reading direction|first look at the current flow/i,
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
