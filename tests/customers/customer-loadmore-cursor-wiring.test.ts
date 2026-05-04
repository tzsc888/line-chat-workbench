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

test("page should preserve long list entries when full refresh request is capped", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const isCappedFullRefresh =/);
  assert.match(page, /limit > responsePageSize/);
  assert.match(page, /const preservedRegularTail = isCappedFullRefresh/);
  assert.match(page, /const replaceBase = \[\.\.\.list, \.\.\.preservedRegularTail\]/);
});

test("schema should include customer composite indexes for cursor sorting", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /@@index\(\[lastMessageAt\(sort: Desc\), id\(sort: Desc\)\]\)/);
  assert.match(schema, /@@index\(\[pinnedAt\(sort: Desc\), id\(sort: Desc\)\]\)/);
});
