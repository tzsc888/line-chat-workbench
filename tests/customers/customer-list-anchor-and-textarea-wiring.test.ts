import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("page should wire customer list viewport anchor and avoid scrollTop-only restore", () => {
  const page = read("app/page.tsx");
  assert.match(page, /data-customer-id=\{customer\.id\}/);
  assert.match(page, /type PreserveCustomerListViewportOptions = \{/);
  assert.match(page, /excludeCustomerIdFromAnchor\?: string \| null/);
  assert.match(page, /const captureCustomerListAnchor = useCallback/);
  assert.match(page, /const restoreCustomerListAnchor = useCallback/);
  assert.match(page, /if \(!container\) return null/);
  assert.match(page, /if \(!cards\.length\) return null/);
  assert.match(page, /const excludedIds = new Set/);
  assert.match(page, /excludedIds\.has\(customerId\)/);
  assert.equal(page.includes("customerId: \"\""), false);
  assert.match(page, /if \(!anchor\) return/);
  assert.match(page, /kind: "scrollTop"/);
  assert.match(page, /if \(anchor\.kind === "scrollTop"\)/);
  assert.match(page, /anchorCard\.getBoundingClientRect\(\)\.top - containerTop/);
  assert.match(page, /container\.scrollTop \+= nextOffsetTop - anchor\.offsetTop/);
  assert.match(page, /const userMovedByLatest = Math\.abs\(latestScrollTop - anchor\.scrollTop\) > threshold/);
  assert.match(page, /const userMovedNow = Math\.abs\(currentScrollTop - anchor\.scrollTop\) > threshold/);
  assert.match(page, /if \(shouldPreserveListUi\) \{\s*restoreCustomerListAnchor\(listAnchor\);\s*\}/);
  const preserveStart = page.indexOf("const preserveCustomerListViewport = useCallback");
  assert.notEqual(preserveStart, -1);
  const preserveSection = page.slice(preserveStart, Math.min(page.length, preserveStart + 500));
  assert.equal(preserveSection.includes("previousScrollTop"), false);
});

test("workspace merge should keep customer list ordering and viewport protection", () => {
  const page = read("app/page.tsx");
  assert.match(page, /preserveCustomerListViewport\(\s*\(\) => \{\s*setCustomers\(\(prev\) => \{/);
  assert.match(page, /excludeCustomerIdFromAnchor: nextWorkspace\.customer\.id/);
  assert.match(page, /pinnedAt: nextWorkspace\.customer\.pinnedAt/);
  assert.match(page, /return sortCustomerList\(applyReadProtectionToCustomers\(merged\)\)/);
});

test("moving customer paths should exclude customer id from anchor capture", () => {
  const page = read("app/page.tsx");
  assert.match(page, /excludeCustomerIdFromAnchor: customerId/);
  assert.match(page, /excludeCustomerIdFromAnchor: normalizedId/);
  assert.match(page, /excludeCustomerIdFromAnchor: nextTargetCustomerId/);
  assert.match(page, /updateCustomerLatestMessage[\s\S]*excludeCustomerIdFromAnchor: customerId/);
});

test("left customer list container should disable browser overflow anchoring", () => {
  const page = read("app/page.tsx");
  assert.match(page, /style=\{\{ overflowAnchor: "none" \}\}/);
});

test("page should remeasure manual reply textarea on key lifecycle changes and cleanup observer", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const scheduleManualReplyTextareaResize = useCallback/);
  assert.match(page, /\[manualReply, scheduleManualReplyTextareaResize\]/);
  assert.match(page, /\[selectedCustomerId, scheduleManualReplyTextareaResize\]/);
  assert.match(page, /\[workspace, scheduleManualReplyTextareaResize\]/);
  assert.match(page, /const observer = new ResizeObserver/);
  assert.match(page, /return \(\) => observer\.disconnect\(\)/);
  assert.match(page, /window\.cancelAnimationFrame\(manualReplyResizeFrameRef\.current\)/);
  assert.match(page, /const minHeight = 44/);
  assert.match(page, /textarea\.style\.height = "auto"/);
  assert.match(page, /setManualReply\(""\)/);
});

test("anchor restore path should not use setTimeout as main strategy", () => {
  const page = read("app/page.tsx");
  const anchorSectionStart = page.indexOf("const captureCustomerListAnchor = useCallback");
  assert.notEqual(anchorSectionStart, -1);
  const anchorSection = page.slice(anchorSectionStart, Math.min(page.length, anchorSectionStart + 2600));
  assert.equal(anchorSection.includes("setTimeout"), false);
  assert.match(anchorSection, /requestAnimationFrame/);
});
