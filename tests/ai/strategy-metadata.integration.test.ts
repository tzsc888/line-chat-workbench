import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftStrategyMetadata } from "../../lib/ai/draft-strategy-metadata";

test("draft metadata includes strategy_version for traceability", () => {
  const metadata = buildDraftStrategyMetadata({
    strategyVersion: "s2-v1",
    analysis: {
      scene_assessment: {
        scene_type: "INITIAL_CONTACT",
        relationship_stage: "",
        latest_message_focus: "",
        tone_attitude: "",
        industry_stage: "INTAKE_RECEPTION",
        buyer_language: "UNKNOWN",
        interest_level: "LOW",
        resistance_level: "NONE",
        reasoning: "",
      },
      routing_decision: {
        route_type: "LIGHT_HOLD",
        reply_goal: "",
        route_reason: "",
        conversion_window: "NONE",
      },
      followup_decision: {
        followup_tier: "C",
        followup_state: "ACTIVE",
        next_followup_bucket: "IN_7_DAYS",
        followup_reason: "",
        should_update_followup: false,
      },
      generation_brief: {
        mission: "",
        must_cover: [],
        must_avoid: [],
        push_level: "LIGHT_HOLD",
        reply_length: "SHORT",
        style_notes: [],
        delivery_anchor: "",
        conversion_step: "RECEIVE",
        boundary_to_establish: "",
      },
      state_update: {
        customer_info_delta: [],
        strategy_delta: [],
        stage_changed: false,
        risk_tags: [],
      },
      review_flags: {
        confidence: "HIGH",
        needs_ai_review: false,
        needs_human_attention: false,
        review_reason: "",
      },
    },
    review: {
      program_checks: {
        passed: true,
        issues: [],
        needs_ai_review: false,
      },
      ai_review: {
        performed: false,
        overall_result: "",
        risk_level: "",
        issues_found: [],
        human_attention_note: "",
        regeneration_recommended: false,
      },
      final_gate: {
        can_show_to_human: true,
        can_recommend_direct_use: true,
        should_highlight_warning: false,
      },
    },
  });

  assert.equal(JSON.parse(metadata.generationBriefJson).strategy_version, "s2-v1");
  assert.equal(JSON.parse(metadata.reviewFlagsJson).strategy_version, "s2-v1");
  assert.equal(JSON.parse(metadata.aiReviewJson).strategy_version, "s2-v1");
});
