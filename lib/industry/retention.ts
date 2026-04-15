export const postFirstOrderRetentionRule = {
  goal: "首单后先安抚和接变化，再判断下一单入口，不把她重新当陌生客。",
  cadence: [
    "24小时：安抚承接交付",
    "2-3天：问变化/反馈",
    "5-7天：判断二单入口",
  ],
  allowedActions: [
    "围绕首单后的变化继续承接",
    "看顾客属于哪种购买语言，再切下一条产品线",
    "低压推进下一步，而不是重新做首单销售",
  ],
  forbiddenActions: [
    "把顾客重新当陌生客追首单",
    "无差别硬推产品",
    "不看变化就直接推进下一单",
  ],
} as const;
