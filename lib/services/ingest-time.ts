export function resolveIngestEventTime(input: {
  sentAt?: string | Date;
  strictSentAt?: boolean;
}) {
  const sentAtInput =
    input.sentAt instanceof Date
      ? input.sentAt
      : typeof input.sentAt === "string" && input.sentAt.trim()
        ? new Date(input.sentAt)
        : null;

  const hasValidSentAt = !!sentAtInput && !Number.isNaN(sentAtInput.getTime());

  if (input.strictSentAt) {
    if (!hasValidSentAt) {
      throw new Error("缺少有效 sentAt，bridge 标准化时间不可回退猜测");
    }
    return sentAtInput!;
  }

  return hasValidSentAt ? sentAtInput! : new Date();
}
