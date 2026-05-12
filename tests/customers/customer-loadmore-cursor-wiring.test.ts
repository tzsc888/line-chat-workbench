import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("/api/customers non-search path should expose cursor pagination wiring", () => {
  const customersRoute = read("app/api/customers/route.ts");
  assert.match(customersRoute, /const rawCursor = req\.nextUrl\.searchParams\.get\("cursor"\)/);
  assert.match(customersRoute, /function decodeRegularCursor/);
  assert.match(customersRoute, /function buildRegularCursorWhere/);
  assert.match(customersRoute, /error:\s*"invalid_cursor"/);
  assert.match(customersRoute, /if \(!isSearching && !cursorParsed\.ok\)/);
  assert.match(customersRoute, /if \(!raw\.includes\("\|"\)\) return \{ ok: false \}/);
  assert.match(customersRoute, /if \(!isIsoUtcDateString\(lastMessageAt\)\) return \{ ok: false \}/);
  assert.match(customersRoute, /if \(!cursor\.lastMessageAt\)/);
  assert.match(customersRoute, /id: \{ lt: cursor\.id \}/);
  assert.match(customersRoute, /nextCursor/);
  assert.match(customersRoute, /const MAX_LIMIT = 500/);
  assert.match(customersRoute, /if \(isSearching\)/);
});

test("page loadMore should use cursor flow for non-search and avoid duplicate cursor requests", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const useCursorLoadMore = isLoadMore && !isSearching/);
  assert.match(page, /params\.set\("cursor", cursorToUse\)/);
  assert.match(page, /requestedRegularCursorsRef/);
  assert.match(page, /setRegularNextCursor\(nextRegularCursorValue\)/);
  assert.match(page, /if \(response\.status === 400 && data\?\.error === "invalid_cursor"\)/);
  assert.match(page, /setHasMoreCustomers\(false\)/);
  assert.match(page, /setRegularNextCursor\(null\)/);
  assert.match(page, /requestedRegularCursorsRef\.current\.delete\(cursorToUse\)/);
  assert.match(page, /requestedRegularCursorsRef\.current\.clear\(\)/);
});

test("loadMore path should not trigger customer stats requests directly", () => {
  const page = read("app/page.tsx");
  const observerSectionStart = page.indexOf("const observer = new IntersectionObserver");
  assert.notEqual(observerSectionStart, -1);
  const observerSection = page.slice(observerSectionStart, Math.min(page.length, observerSectionStart + 700));
  assert.match(observerSection, /loadCustomers\(\{ loadMore: true/);
  assert.equal(observerSection.includes("loadCustomerStats"), false);
});

test("page should preserve long list entries during preserve-ui refreshes", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const shouldPreserveExistingCustomers =/);
  assert.match(page, /!isSearching/);
  assert.match(page, /shouldPreserveListUi/);
  assert.match(page, /const preservedExistingCustomers = shouldPreserveExistingCustomers/);
  assert.match(page, /const replaceBase = \[\.\.\.list, \.\.\.preservedExistingCustomers\]/);
  assert.equal(page.includes("limit > responsePageSize"), false);
});

test("mark-read and local follow-up refreshes should not replace the full customer list", () => {
  const page = read("app/page.tsx");
  const markReadStart = page.indexOf("const markCustomerRead = useCallback");
  assert.notEqual(markReadStart, -1);
  const markReadEnd = page.indexOf("const loadWorkspace = useCallback", markReadStart);
  assert.notEqual(markReadEnd, -1);
  const markReadSection = page.slice(markReadStart, markReadEnd);
  assert.equal(markReadSection.includes("loadCustomers({"), false);
  assert.match(markReadSection, /recentLocalRefreshAtRef\.current\[customerId\] = Date\.now\(\)/);

  const postGenerateStart = page.indexOf("const runPostGenerateRefresh = useCallback");
  assert.notEqual(postGenerateStart, -1);
  const postGenerateSection = page.slice(postGenerateStart, Math.min(page.length, postGenerateStart + 900));
  assert.match(postGenerateSection, /refreshCustomerSummary\(customerId, \{ preserveUi: true \}\)/);
  assert.equal(postGenerateSection.includes("loadCustomers({ preserveUi: true })"), false);

  assert.match(page, /await refreshCustomerSummary\(workspace\.customer\.id, \{ preserveUi: true \}\)/);
  assert.equal(page.includes("await loadCustomers({ preserveUi: true });"), false);
});

test("mark-read protection should only suppress stale list responses with request timestamps", () => {
  const page = read("app/page.tsx");
  const protectionStart = page.indexOf("const getUnreadProtectionReason = useCallback");
  assert.notEqual(protectionStart, -1);
  const protectionSection = page.slice(protectionStart, Math.min(page.length, protectionStart + 900));
  assert.match(protectionSection, /if \(requestStartedAt && requestStartedAt <= confirmedAt\)/);
  assert.equal(protectionSection.includes("if (!requestStartedAt || requestStartedAt <= confirmedAt)"), false);
});

test("schema should include customer composite indexes for cursor sorting", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /@@index\(\[lastMessageAt\(sort: Desc\), id\(sort: Desc\)\]\)/);
  assert.match(schema, /@@index\(\[pinnedAt\(sort: Desc\), id\(sort: Desc\)\]\)/);
});
