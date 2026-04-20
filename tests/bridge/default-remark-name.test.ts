import test from "node:test";
import assert from "node:assert/strict";
import { buildDefaultRemarkName } from "../../lib/customers/default-remark-name";

test("buildDefaultRemarkName uses same date-prefix format for bridge and legacy", () => {
  const fixedDate = new Date("2026-04-20T03:10:00.000Z"); // Asia/Tokyo: 2026-04-20 12:10
  const remark = buildDefaultRemarkName("田中", "u123", fixedDate);
  assert.equal(remark, "26.4.20田中");
});

test("buildDefaultRemarkName falls back to 未命名顾客 when original name is empty", () => {
  const fixedDate = new Date("2026-04-20T03:10:00.000Z");
  const remark = buildDefaultRemarkName("", "thread-abc", fixedDate);
  assert.equal(remark, "26.4.20未命名顾客");
});
