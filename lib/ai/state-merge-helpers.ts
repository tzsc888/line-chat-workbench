import type { AnalysisResult, FollowupBucketTiming } from "./ai-types";

function splitLines(text: string) {
  return text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mergeUniqueText(base: string, additions: string[], maxLines = 8) {
  const parts = [...splitLines(base), ...additions.map((item) => item.trim()).filter(Boolean)];
  return Array.from(new Set(parts)).slice(0, maxLines).join("\n");
}

export function mergeUniqueTags(base: string[], additions: string[]) {
  const normalized = [...base, ...additions]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 50);
  return Array.from(new Set(normalized));
}

export function timingBucketToDate(bucket: FollowupBucketTiming) {
  const now = Date.now();
  switch (bucket) {
    case "IMMEDIATE":
      return new Date(now);
    case "TODAY":
      return new Date(now + 2 * 60 * 60 * 1000);
    case "IN_1_DAY":
      return new Date(now + 24 * 60 * 60 * 1000);
    case "IN_3_DAYS":
      return new Date(now + 3 * 24 * 60 * 60 * 1000);
    case "IN_7_DAYS":
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
    case "NO_SET":
    default:
      return null;
  }
}

export function stageToCustomerStage(input: string) {
  const normalized = input.toUpperCase();
  const allowed = ["NEW", "FIRST_CONTACT", "FOLLOWING_UP", "INTERESTED", "NEGOTIATING", "WAITING_PAYMENT", "PAID", "AFTER_SALES", "LOST"];
  return allowed.includes(normalized) ? normalized : undefined;
}

export function mapAnalysisFollowupState(input: AnalysisResult["followup_decision"]["followup_state"]) {
  if (
    input === "ACTIVE" ||
    input === "OBSERVING" ||
    input === "WAITING_WINDOW" ||
    input === "POST_PURCHASE_CARE" ||
    input === "DONE" ||
    input === "PAUSED"
  ) {
    return input;
  }
  return "ACTIVE";
}
