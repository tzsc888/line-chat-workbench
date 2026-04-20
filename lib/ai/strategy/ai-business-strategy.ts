import type { AiBusinessStrategy } from "./schema";

/**
 * AI 业务策略（唯一主要编辑入口）
 *
 * 使用说明（给业务/运营同学）：
 * 1. 日常只改这个文件，不需要改 resolver、service 或 prompt 文件。
 * 2. 每个区块都有“改这里会影响什么”的说明。
 * 3. 本文件默认值已按当前线上行为配置，建议小步改动并配合回归测试。
 * 4. advanced 区块是高级项，不建议日常修改。
 */
export const AI_BUSINESS_STRATEGY: AiBusinessStrategy = {
  /**
   * 版本号：用于追踪“当前这条建议是按哪版策略生成”。
   * 改这里会影响什么：新生成的 analysis/suggestions/review 元数据版本标记。
   */
  version: "s2-v1",
  notes: "阶段 2 首版策略：默认复刻阶段 1 行为，不做风格漂移",

  /**
   * 翻译策略（日常可改）
   * 改这里会影响什么：客户消息翻译时的语气保持与术语偏好。
   */
  translation: {
    enabled: true,
    preserveToneNotes: ["保留语气、保留保留感、保留软拒绝或试探感"],
    specialTerms: [],
  },

  /**
   * 销售流程理解策略（日常可改）
   * 改这里会影响什么：analysis 对“是否该推进/该保守”的判断参考语境。
   */
  sales_process: {
    analysisCoreSalesRules: [
      "先判断当前局面，再决定是否推进",
      "不确定时默认更保守",
      "不是每条消息都值得生成销售建议",
    ],
  },

  /**
   * 回复风格策略（日常可改）
   * 改这里会影响什么：analysis/generation/review 三处的风格约束文本。
   */
  reply_style: {
    analysisCoreStyleRules: [
      "像日本成年人LINE私聊，不像客服模板",
      "默认短、自然、克制",
      "避免太油、太冷、太长、太像翻译软件",
    ],
    generationStyleRules: [
      "像真人LINE短聊",
      "默认短句，不要小作文",
      "不要像客服模板",
    ],
    reviewStyleRules: [
      "不能像客服模板",
      "日语要自然",
      "中文解释必须忠实于日语",
      "必须像真人LINE即时聊天",
    ],
  },

  /**
   * 生成/复用策略（日常可改）
   * 改这里会影响什么：是否复用旧草稿，以及何时必须重算。
   */
  generation_policy: {
    reuseDraft: {
      onlyAutoMode: true,
      requireEmptyRewriteInput: true,
      requireSameTargetMessage: true,
      requireUnselectedDraft: true,
      requireFreshDraft: true,
    },
  },

  /**
   * 质检/风险门控策略（日常可改）
   * 改这里会影响什么：哪些场景一定进 AI review，以及 review 风险红线。
   */
  review_policy: {
    runAiReviewWhen: {
      vipAlways: true,
      analysisNeedsReview: true,
      programNeedsReview: true,
      confidenceLevels: ["LOW"],
      sceneTypes: ["CLEAR_OBJECTION", "BUDGET_HESITATION", "POST_PURCHASE_FOLLOWUP"],
    },
    reviewCriticalRules: [
      "不能跳阶段",
      "不能推进过头",
      "不能免费讲太深",
      "首轮接待不能写成深度承接",
      "免费文后承接不能写成第二篇免费鉴定文",
    ],
    reviewRiskRules: [
      "两版差异要真实有效",
      "高风险时应提醒人工",
      "必须承接前面的交付内容，而不是当成全新话题",
    ],
  },

  /**
   * 跟进策略（日常可改，仅参数化）
   * 改这里会影响什么：默认跟进层级、时间窗口、默认理由文案。
   * 注意：本阶段不改 followup 引擎算法，只改参数。
   */
  followup_policy: {
    defaultTierByStage: {
      aStages: ["WAITING_PAYMENT", "NEGOTIATING", "INTERESTED"],
      bStages: ["FOLLOWING_UP", "FIRST_CONTACT", "NEW"],
    },
    timingHours: {
      todayOffsetHours: 2,
    },
    timingDays: {
      in1Day: 1,
      in3Days: 3,
      in7Days: 7,
    },
    vipTimingByTier: {
      A: "TODAY",
      B: "IN_3_DAYS",
      C: "IN_7_DAYS",
    },
    unconvertedTimingByTier: {
      A: "TODAY",
      B: "IN_1_DAY",
      C: "IN_7_DAYS",
    },
    reasonTemplates: {
      unfollowed: "顾客已取消关注，暂不主动跟进",
      unreadFirst: "有新消息，建议优先处理",
      vipDefault: "已成交顾客，建议持续经营",
      waitingPaymentOrNegotiating: "接近成交，建议重点跟进",
      interested: "顾客兴趣较高，建议保持跟进",
      fallback: "常规跟进",
    },
  },

  /**
   * 高级配置（advanced，不建议日常修改）
   * 改这里会影响什么：模型采样温度，可能直接影响回复稳定性。
   */
  advanced: {
    temperatures: {
      translation: 0.1,
      analysis: 0.15,
      generation: 0.35,
      review: 0.1,
    },
  },
};
