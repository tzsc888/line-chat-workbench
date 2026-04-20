function getDateParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((item) => item.type === "year")?.value || String(now.getFullYear()).slice(-2);
  const month = parts.find((item) => item.type === "month")?.value || String(now.getMonth() + 1);
  const day = parts.find((item) => item.type === "day")?.value || String(now.getDate());
  return { year, month, day };
}

export function buildDefaultRemarkName(originalName: string, _identity: string, now = new Date()) {
  const { year, month, day } = getDateParts(now);
  const cleanedName = originalName.trim();
  const baseName = cleanedName || "未命名顾客";
  return `${year}.${month}.${day}${baseName}`;
}
