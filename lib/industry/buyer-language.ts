import type { BuyerLanguage } from "../ai/ai-types";

export const buyerLanguageGuide: Record<BuyerLanguage, { signal: string; productDirection: string }> = {
  ANSWER: {
    signal: "一直追问结果、对方怎么想、接下来会怎么走，优先吃判断和变化解释。",
    productDirection: "判断/变化解释/近期走势",
  },
  STATE: {
    signal: "更在意自己很累、很乱、很痛、睡不好、停不下来，优先吃状态调整。",
    productDirection: "浄化/ヒーリング/波動修正",
  },
  RELATIONSHIP: {
    signal: "目标很明确，就是想把关系推起来，优先吃关系推进产品。",
    productDirection: "縁結び/祈願/ご縁調整",
  },
  SPIRITUAL: {
    signal: "本身就自然接受守護/波動/エネルギー语言，优先吃更深灵性产品。",
    productDirection: "更深灵性产品",
  },
  UNKNOWN: {
    signal: "购买语言尚不明确，先不要硬切产品线。",
    productDirection: "先承接并继续判断",
  },
};
