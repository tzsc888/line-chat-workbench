import type {
  AnalysisContextPack,
  AnalysisResult,
  ContextMessage,
  GenerationContextPack,
  ReviewContextPack,
  TranslationResult,
} from "./ai-types";
import { buildDeliveryContextFromMessages, deriveIndustryStage, getIndustryRulePack, getIndustryStageSummary } from "../industry/core";
import { resolveAnalysisStrategy, resolveGenerationStrategy, resolveReviewStrategy } from "./strategy";

function shorten(text: string, max = 280) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const head = Math.max(120, Math.floor(max * 0.7));
  const tail = Math.max(40, max - head - 12);
  return `${normalized.slice(0, head)} ... ${normalized.slice(-tail)}`;
}

function mapRecentContext(messages: ContextMessage[], max = 6) {
  return messages.slice(-max).map((message) => ({
    role: "customer_or_staff" as const,
    japanese_text: shorten(message.japaneseText, 220),
    chinese_translation: shorten(message.chineseText || "", 140),
  }));
}

export function buildAnalysisContext(input: {
  customer: {
    id: string;
    remarkName: string | null;
    originalName: string;
    isVip: boolean;
    stage: string;
    aiCustomerInfo: string | null;
    aiCurrentStrategy: string | null;
    followupTier?: string | null;
    followupState?: string | null;
    followupBucket?: string | null;
    nextFollowupBucket?: string | null;
    lineRelationshipStatus?: string | null;
    riskTags?: string[];
  };
  latestMessage: ContextMessage;
  translation?: TranslationResult | null;
  recentMessages: ContextMessage[];
}): AnalysisContextPack {
  const deliveryContext = buildDeliveryContextFromMessages({
    latestMessage: input.latestMessage,
    recentMessages: input.recentMessages,
    customerStage: input.customer.stage,
  });
  const industryStage = deriveIndustryStage({
    customerStage: input.customer.stage,
    latestMessage: input.latestMessage,
    recentMessages: input.recentMessages,
    deliveryContext,
  });
  const stageSummary = getIndustryStageSummary(industryStage);
  const industryRulePack = getIndustryRulePack(industryStage);
  const strategy = resolveAnalysisStrategy();

  return {
    customer_profile: {
      customer_id: input.customer.id,
      display_name: input.customer.remarkName?.trim() || input.customer.originalName,
      is_vip: input.customer.isVip,
      has_purchased: input.customer.stage === "PAID" || input.customer.stage === "AFTER_SALES",
      relationship_status: input.customer.lineRelationshipStatus || "ACTIVE",
      long_term_summary: input.customer.aiCustomerInfo || "",
      current_stage: input.customer.stage || "",
      current_strategy_summary: input.customer.aiCurrentStrategy || "",
      risk_tags: input.customer.riskTags || [],
      current_followup_tier: input.customer.followupTier || "",
      current_followup_state: input.customer.followupState || "",
      current_followup_bucket: input.customer.nextFollowupBucket || input.customer.followupBucket || "",
    },
    industry_stage: industryStage,
    delivery_context: deliveryContext,
    industry_rules_summary: {
      stage_goal: industryRulePack.stageGoal,
      stage_dos: [...industryRulePack.stageDos],
      stage_donts: [...industryRulePack.stageDonts],
      stage_style: [...industryRulePack.stageStyle],
      step_rules: [...industryRulePack.stepRules],
      buyer_language_signal: industryRulePack.buyerLanguageSignal,
      buyer_language_product_direction: industryRulePack.buyerLanguageProductDirection,
      must_have: [...industryRulePack.mustHave],
    },
    latest_message: {
      message_id: input.latestMessage.id,
      japanese_text: shorten(input.latestMessage.japaneseText, 300),
      chinese_translation: input.translation?.translation || input.latestMessage.chineseText || "",
      tone_notes: input.translation?.tone_notes || "",
      ambiguity_notes: input.translation?.ambiguity_notes || "",
    },
    recent_context: mapRecentContext(input.recentMessages, 6),
    system_rules_summary: {
      core_style_rules: [...strategy.coreStyleRules, ...stageSummary.styleNotes],
      core_sales_rules: [
        ...strategy.coreSalesRules,
        stageSummary.goal,
        ...stageSummary.allowedActions.map((item) => `允许动作：${item}`),
      ],
      core_risk_rules: [
        "不能跳阶段",
        "不能推进过头",
        "不能免费讲太深",
        ...stageSummary.forbiddenActions.map((item) => `禁止动作：${item}`),
      ],
    },
  };
}

export function buildGenerationContext(input: {
  analysis: AnalysisResult;
  latestMessage: ContextMessage;
  translation?: TranslationResult | null;
  recentMessages: ContextMessage[];
  customer: {
    stage: string;
    aiCurrentStrategy: string | null;
    riskTags?: string[];
    hasPurchased: boolean;
  };
  deliveryContext?: AnalysisContextPack["delivery_context"];
}): GenerationContextPack {
  const deliveryContext =
    input.deliveryContext ||
    buildDeliveryContextFromMessages({
      latestMessage: input.latestMessage,
      recentMessages: input.recentMessages,
      customerStage: input.customer.stage,
    });
  const industryRulePack = getIndustryRulePack(
    input.analysis.scene_assessment.industry_stage,
    input.analysis.scene_assessment.buyer_language,
  );
  const strategy = resolveGenerationStrategy();

  return {
    industry_stage: input.analysis.scene_assessment.industry_stage,
    delivery_context: deliveryContext,
    industry_rules_summary: {
      stage_goal: industryRulePack.stageGoal,
      stage_dos: [...industryRulePack.stageDos],
      stage_donts: [...industryRulePack.stageDonts],
      stage_style: [...industryRulePack.stageStyle],
      step_rules: [...industryRulePack.stepRules],
      buyer_language_signal: industryRulePack.buyerLanguageSignal,
      buyer_language_product_direction: industryRulePack.buyerLanguageProductDirection,
      must_have: [...industryRulePack.mustHave],
    },
    generation_brief: {
      scene_type: input.analysis.scene_assessment.scene_type,
      relationship_stage: input.analysis.scene_assessment.relationship_stage,
      route_type: input.analysis.routing_decision.route_type,
      reply_goal: input.analysis.routing_decision.reply_goal,
      buyer_language: input.analysis.scene_assessment.buyer_language,
      mission: input.analysis.generation_brief.mission,
      must_cover: input.analysis.generation_brief.must_cover,
      must_avoid: input.analysis.generation_brief.must_avoid,
      push_level: input.analysis.generation_brief.push_level,
      reply_length: input.analysis.generation_brief.reply_length,
      style_notes: input.analysis.generation_brief.style_notes,
      delivery_anchor: input.analysis.generation_brief.delivery_anchor,
      conversion_step: input.analysis.generation_brief.conversion_step,
      boundary_to_establish: input.analysis.generation_brief.boundary_to_establish,
    },
    latest_message: {
      japanese_text: shorten(input.latestMessage.japaneseText, 300),
      chinese_translation: input.translation?.translation || input.latestMessage.chineseText || "",
      tone_notes: input.translation?.tone_notes || "",
    },
    recent_context: mapRecentContext(input.recentMessages, 4),
    current_status_card: {
      current_stage: input.customer.stage,
      current_strategy_summary: input.customer.aiCurrentStrategy || "",
      risk_tags: input.customer.riskTags || [],
      has_purchased: input.customer.hasPurchased,
    },
    global_rules: {
      style_rules: [...strategy.styleRules],
      sales_rules: [
        "必须服从上游路线",
        "不能自行新增承诺、价格、卖点",
        "A更稳，B更主动半步",
        "首轮接待只做接住与控场，不做深度判断",
        "免费鉴定文后的承接遵守：接住主题 -> 机制命中 -> 建立免费不够的边界 -> 自然引向个别深度鉴定",
      ],
      risk_rules: [
        "不要推进过头",
        "不要免费讲太深",
        "不要写得太油或太硬",
        "不要把承接写成第二篇正式鉴定文",
      ],
    },
  };
}

export function buildReviewContext(input: {
  analysis: AnalysisResult;
  generation: ReviewContextPack["generation_result"];
  latestMessage: ContextMessage;
  translation?: TranslationResult | null;
  deliveryContext?: AnalysisContextPack["delivery_context"];
  recentMessages?: ContextMessage[];
  customerStage?: string;
}): ReviewContextPack {
  const deliveryContext =
    input.deliveryContext ||
    buildDeliveryContextFromMessages({
      latestMessage: input.latestMessage,
      recentMessages: input.recentMessages || [],
      customerStage: input.customerStage || "",
    });
  const industryRulePack = getIndustryRulePack(
    input.analysis.scene_assessment.industry_stage,
    input.analysis.scene_assessment.buyer_language,
  );
  const strategy = resolveReviewStrategy();

  return {
    industry_stage: input.analysis.scene_assessment.industry_stage,
    delivery_context: deliveryContext,
    industry_rules_summary: {
      stage_goal: industryRulePack.stageGoal,
      stage_dos: [...industryRulePack.stageDos],
      stage_donts: [...industryRulePack.stageDonts],
      stage_style: [...industryRulePack.stageStyle],
      step_rules: [...industryRulePack.stepRules],
      buyer_language_signal: industryRulePack.buyerLanguageSignal,
      buyer_language_product_direction: industryRulePack.buyerLanguageProductDirection,
      must_have: [...industryRulePack.mustHave],
    },
    analysis_result: {
      scene_type: input.analysis.scene_assessment.scene_type,
      route_type: input.analysis.routing_decision.route_type,
      reply_goal: input.analysis.routing_decision.reply_goal,
      push_level: input.analysis.generation_brief.push_level,
      buyer_language: input.analysis.scene_assessment.buyer_language,
      conversion_window: input.analysis.routing_decision.conversion_window,
      must_cover: input.analysis.generation_brief.must_cover,
      must_avoid: input.analysis.generation_brief.must_avoid,
      style_notes: input.analysis.generation_brief.style_notes,
      delivery_anchor: input.analysis.generation_brief.delivery_anchor,
      conversion_step: input.analysis.generation_brief.conversion_step,
      boundary_to_establish: input.analysis.generation_brief.boundary_to_establish,
      confidence: input.analysis.review_flags.confidence,
      needs_human_attention: input.analysis.review_flags.needs_human_attention,
    },
    latest_message: {
      japanese_text: shorten(input.latestMessage.japaneseText, 300),
      chinese_translation: input.translation?.translation || input.latestMessage.chineseText || "",
    },
    generation_result: input.generation,
    global_review_rules: {
      critical_rules: [...strategy.criticalRules],
      style_rules: [...strategy.styleRules],
      risk_rules: [...strategy.riskRules],
    },
  };
}
