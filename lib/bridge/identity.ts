export function cleanBridgeText(value: unknown) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

export function normalizeBridgeThreadId(value: unknown) {
  return cleanBridgeText(value);
}

export function sanitizeBridgeDisplayName(value: unknown) {
  const cleaned = cleanBridgeText(value);
  return cleaned && cleaned !== "Unknown" ? cleaned : "";
}

export function isValidIsoTimestamp(value: unknown) {
  const raw = cleanBridgeText(value);
  if (!raw) return false;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime());
}

export function buildBridgePlaceholderName(threadId: string) {
  const normalized = normalizeBridgeThreadId(threadId);
  if (!normalized) return "LINE网页会话";
  return `LINE网页会话 ${normalized.slice(-8)}`;
}
