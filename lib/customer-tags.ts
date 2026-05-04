export const CUSTOMER_TAG_LIMIT = 10;
export const CUSTOMER_TAG_NAME_MAX_LENGTH = 20;

export const CUSTOMER_TAG_COLOR_PALETTE = [
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#65A30D",
  "#9333EA",
  "#0F766E",
] as const;

export function normalizeTagName(value: unknown) {
  return String(value ?? "").trim();
}

export function isValidTagName(name: string) {
  return !!name && name.length <= CUSTOMER_TAG_NAME_MAX_LENGTH;
}

export function pickNextTagColor(existingColors: string[]) {
  const normalizedUsed = new Set(
    existingColors.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
  );
  const firstUnused = CUSTOMER_TAG_COLOR_PALETTE.find((color) => !normalizedUsed.has(color.toUpperCase()));
  if (firstUnused) return firstUnused;
  return CUSTOMER_TAG_COLOR_PALETTE[existingColors.length % CUSTOMER_TAG_COLOR_PALETTE.length];
}
