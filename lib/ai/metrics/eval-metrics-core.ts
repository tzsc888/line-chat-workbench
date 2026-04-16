import {
  ANALYSIS_PROMPT_VERSION,
  GENERATION_PROMPT_VERSION,
  REVIEW_PROMPT_VERSION,
  TRANSLATION_PROMPT_VERSION,
} from "../prompts/versions";

export type DraftMetricRow = {
  customerId: string;
  routeType: string | null;
  sceneType: string | null;
  pushLevel: string | null;
  selectedVariant: "STABLE" | "ADVANCING" | null;
  recommendedVariant: "STABLE" | "ADVANCING" | null;
  isStale: boolean;
  staleReason: string | null;
  finalGateJson: string | null;
  reviewFlagsJson: string | null;
  aiReviewJson: string | null;
  analysisPromptVersion: string | null;
  generationPromptVersion: string | null;
  reviewPromptVersion: string | null;
  translationPromptVersion: string | null;
};

type ReviewIssue = {
  issue_type?: string;
  explanation?: string;
};

type ParsedAiReview = {
  overall_result?: string;
  risk_level?: string;
  issues_found?: ReviewIssue[];
};

type ParsedReviewFlags = {
  needs_human_attention?: boolean;
  confidence?: string;
};

type ParsedFinalGate = {
  can_show_to_human?: boolean;
};

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function sortBreakdown(items: Array<{ key: string; count: number }>, total: number) {
  return items
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map((item) => ({ key: item.key, count: item.count, share: percent(item.count, total) }));
}

function aggregateCountMap(values: Array<string | null | undefined>, fallback = "UNKNOWN") {
  const map = new Map<string, number>();
  for (const value of values) {
    const key = value && value.trim() ? value : fallback;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function toBreakdown(map: Map<string, number>, total: number) {
  return sortBreakdown(Array.from(map.entries()).map(([key, count]) => ({ key, count })), total);
}

export function computeAiEvalMetricsFromDrafts(rows: DraftMetricRow[], windowDays = 30) {
  const totalDrafts = rows.length;
  const selectedDrafts = rows.filter((row) => row.selectedVariant !== null).length;
  const selectedStable = rows.filter((row) => row.selectedVariant === "STABLE").length;
  const selectedAdvancing = rows.filter((row) => row.selectedVariant === "ADVANCING").length;
  const recommendedStable = rows.filter((row) => row.recommendedVariant === "STABLE").length;
  const recommendedAdvancing = rows.filter((row) => row.recommendedVariant === "ADVANCING").length;
  const staleDrafts = rows.filter((row) => row.isStale).length;
  const staleReasons = toBreakdown(
    aggregateCountMap(
      rows.filter((row) => row.isStale).map((row) => row.staleReason),
      "UNKNOWN",
    ),
    staleDrafts,
  );

  let blockedDrafts = 0;
  let needsAttentionDrafts = 0;
  const reviewResultMap = new Map<string, number>();
  const riskLevelMap = new Map<string, number>();
  const confidenceMap = new Map<string, number>();
  const issueMap = new Map<string, number>();

  for (const row of rows) {
    const finalGate = safeJsonParse<ParsedFinalGate>(row.finalGateJson);
    const reviewFlags = safeJsonParse<ParsedReviewFlags>(row.reviewFlagsJson);
    const aiReview = safeJsonParse<ParsedAiReview>(row.aiReviewJson);

    if (finalGate?.can_show_to_human === false) blockedDrafts += 1;
    if (reviewFlags?.needs_human_attention) needsAttentionDrafts += 1;
    if (reviewFlags?.confidence) {
      confidenceMap.set(reviewFlags.confidence, (confidenceMap.get(reviewFlags.confidence) || 0) + 1);
    }
    if (aiReview?.overall_result) {
      reviewResultMap.set(aiReview.overall_result, (reviewResultMap.get(aiReview.overall_result) || 0) + 1);
    }
    if (aiReview?.risk_level) {
      riskLevelMap.set(aiReview.risk_level, (riskLevelMap.get(aiReview.risk_level) || 0) + 1);
    }
    for (const issue of aiReview?.issues_found || []) {
      const key = issue.issue_type || issue.explanation || "UNKNOWN";
      issueMap.set(key, (issueMap.get(key) || 0) + 1);
    }
  }

  const uniqueCustomers = new Set(rows.map((row) => row.customerId)).size;

  return {
    windowDays,
    totals: {
      totalDrafts,
      selectedDrafts,
      staleDrafts,
      blockedDrafts,
      needsAttentionDrafts,
      uniqueCustomers,
    },
    adoption: {
      selectedRate: percent(selectedDrafts, totalDrafts),
      stableRateAmongSelected: percent(selectedStable, selectedDrafts),
      advancingRateAmongSelected: percent(selectedAdvancing, selectedDrafts),
      recommendedStableRate: percent(recommendedStable, totalDrafts),
      recommendedAdvancingRate: percent(recommendedAdvancing, totalDrafts),
      staleRate: percent(staleDrafts, totalDrafts),
      blockedRate: percent(blockedDrafts, totalDrafts),
      humanAttentionRate: percent(needsAttentionDrafts, totalDrafts),
      draftsPerCustomer: uniqueCustomers ? Number((totalDrafts / uniqueCustomers).toFixed(2)) : 0,
    },
    routeBreakdown: toBreakdown(aggregateCountMap(rows.map((row) => row.routeType), "UNKNOWN"), totalDrafts).map((item) => ({
      routeType: item.key,
      count: item.count,
      share: item.share,
    })),
    sceneBreakdown: toBreakdown(aggregateCountMap(rows.map((row) => row.sceneType), "UNKNOWN"), totalDrafts).map((item) => ({
      sceneType: item.key,
      count: item.count,
      share: item.share,
    })),
    pushLevelBreakdown: toBreakdown(aggregateCountMap(rows.map((row) => row.pushLevel), "UNKNOWN"), totalDrafts).map((item) => ({
      pushLevel: item.key,
      count: item.count,
      share: item.share,
    })),
    confidenceBreakdown: toBreakdown(confidenceMap, totalDrafts).map((item) => ({
      confidence: item.key,
      count: item.count,
      share: item.share,
    })),
    reviewResultBreakdown: toBreakdown(reviewResultMap, totalDrafts).map((item) => ({
      overallResult: item.key,
      count: item.count,
      share: item.share,
    })),
    riskLevelBreakdown: toBreakdown(riskLevelMap, totalDrafts).map((item) => ({
      riskLevel: item.key,
      count: item.count,
      share: item.share,
    })),
    staleReasonBreakdown: staleReasons.map((item) => ({
      staleReason: item.key,
      count: item.count,
      share: item.share,
    })),
    topIssues: sortBreakdown(
      Array.from(issueMap.entries()).map(([key, count]) => ({ key, count })),
      totalDrafts,
    )
      .slice(0, 10)
      .map((item) => ({
        issueType: item.key,
        count: item.count,
        share: item.share,
      })),
    promptVersionBreakdown: {
      translation: toBreakdown(
        aggregateCountMap(rows.map((row) => row.translationPromptVersion), TRANSLATION_PROMPT_VERSION),
        totalDrafts,
      ),
      analysis: toBreakdown(
        aggregateCountMap(rows.map((row) => row.analysisPromptVersion), ANALYSIS_PROMPT_VERSION),
        totalDrafts,
      ),
      generation: toBreakdown(
        aggregateCountMap(rows.map((row) => row.generationPromptVersion), GENERATION_PROMPT_VERSION),
        totalDrafts,
      ),
      review: toBreakdown(
        aggregateCountMap(rows.map((row) => row.reviewPromptVersion), REVIEW_PROMPT_VERSION),
        totalDrafts,
      ),
    },
    promptVersions: {
      translation: TRANSLATION_PROMPT_VERSION,
      analysis: ANALYSIS_PROMPT_VERSION,
      generation: GENERATION_PROMPT_VERSION,
      review: REVIEW_PROMPT_VERSION,
    },
  };
}
