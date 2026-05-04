import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("tags api routes should exist and wire expected handlers", () => {
  const tagsRoute = read("app/api/tags/route.ts");
  const tagDeleteRoute = read("app/api/tags/[tagId]/route.ts");
  const customerTagPostRoute = read("app/api/customers/[customerId]/tags/route.ts");
  const customerTagDeleteRoute = read("app/api/customers/[customerId]/tags/[tagId]/route.ts");

  assert.match(tagsRoute, /export async function GET\(/);
  assert.match(tagsRoute, /export async function POST\(/);
  assert.match(tagDeleteRoute, /export async function DELETE\(/);
  assert.match(customerTagPostRoute, /export async function POST\(/);
  assert.match(customerTagDeleteRoute, /export async function DELETE\(/);
});

test("POST /api/tags should enforce validation, limit, duplicate and assign color/sortOrder", () => {
  const tagsRoute = read("app/api/tags/route.ts");
  const helper = read("lib/customer-tags.ts");

  assert.match(helper, /CUSTOMER_TAG_LIMIT\s*=\s*10/);
  assert.match(helper, /CUSTOMER_TAG_COLOR_PALETTE/);
  assert.match(tagsRoute, /invalid_tag_name/);
  assert.match(tagsRoute, /tag_limit_reached/);
  assert.match(tagsRoute, /tag_name_exists/);
  assert.match(tagsRoute, /normalizeTagName/);
  assert.match(tagsRoute, /pickNextTagColor/);
  assert.match(tagsRoute, /maxSortOrder \+ 1/);
  assert.match(tagsRoute, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(tagsRoute, /MAX_RETRIES_ON_P2034/);
  assert.match(tagsRoute, /error\.code === "P2034"/);
  assert.match(tagsRoute, /attempt < MAX_RETRIES_ON_P2034/);
  assert.match(tagsRoute, /error\.code === "P2002"/);
});

test("customer tag attach and detach should publish refresh with customer-tags-updated", () => {
  const customerTagPostRoute = read("app/api/customers/[customerId]/tags/route.ts");
  const customerTagDeleteRoute = read("app/api/customers/[customerId]/tags/[tagId]/route.ts");

  assert.match(customerTagPostRoute, /publishRealtimeRefresh\(/);
  assert.match(customerTagPostRoute, /reason:\s*"customer-tags-updated"/);
  assert.match(customerTagPostRoute, /customerId/);
  assert.match(customerTagDeleteRoute, /publishRealtimeRefresh\(/);
  assert.match(customerTagDeleteRoute, /reason:\s*"customer-tags-updated"/);
  assert.match(customerTagDeleteRoute, /customerId/);
});

test("DELETE /api/tags/[tagId] should validate id, delete relations + tag in transaction, and publish refresh safely", () => {
  const tagDeleteRoute = read("app/api/tags/[tagId]/route.ts");
  const ably = read("lib/ably.ts");
  assert.match(tagDeleteRoute, /invalid_tag_id/);
  assert.match(tagDeleteRoute, /tag_not_found/);
  assert.match(tagDeleteRoute, /prisma\.customerTag\.findMany/);
  assert.match(tagDeleteRoute, /distinct:\s*\["customerId"\]/);
  assert.match(tagDeleteRoute, /prisma\.\$transaction/);
  assert.match(tagDeleteRoute, /tx\.customerTag\.deleteMany/);
  assert.match(tagDeleteRoute, /tx\.tag\.delete/);
  assert.match(tagDeleteRoute, /PER_CUSTOMER_PUBLISH_LIMIT\s*=\s*50/);
  assert.match(tagDeleteRoute, /affectedCustomerIds\.length <= PER_CUSTOMER_PUBLISH_LIMIT/);
  assert.match(tagDeleteRoute, /reason:\s*"customer-tags-updated"/);
  assert.match(tagDeleteRoute, /reason:\s*"tags-updated"/);
  assert.match(tagDeleteRoute, /tagId:\s*normalizedTagId/);
  assert.match(ably, /tagId\?: string \| null/);
  assert.match(ably, /typeof payload\.tagId !== "string" \|\| !payload\.tagId\.trim\(\)/);
  assert.match(ably, /payload\.tagId = payload\.tagId\.trim\(\)/);
  assert.equal(tagDeleteRoute.includes("messageId"), false);
});

test("POST /api/customers/[customerId]/tags should validate empty or non-string tagId as invalid_tag_id", () => {
  const customerTagPostRoute = read("app/api/customers/[customerId]/tags/route.ts");
  assert.match(customerTagPostRoute, /typeof body\?\.tagId !== "string"/);
  assert.match(customerTagPostRoute, /invalid_tag_id/);
  assert.match(customerTagPostRoute, /status: 400/);
  assert.match(customerTagPostRoute, /tag_not_found/);
});

test("tag routes should not wire failExpiredOutboundTasks and this step should not edit app/page.tsx", () => {
  const tagsRoute = read("app/api/tags/route.ts");
  const tagDeleteRoute = read("app/api/tags/[tagId]/route.ts");
  const customerTagPostRoute = read("app/api/customers/[customerId]/tags/route.ts");
  const customerTagDeleteRoute = read("app/api/customers/[customerId]/tags/[tagId]/route.ts");
  const page = read("app/page.tsx");

  assert.equal(tagsRoute.includes("failExpiredOutboundTasks"), false);
  assert.equal(tagDeleteRoute.includes("failExpiredOutboundTasks"), false);
  assert.equal(customerTagPostRoute.includes("failExpiredOutboundTasks"), false);
  assert.equal(customerTagDeleteRoute.includes("failExpiredOutboundTasks"), false);
  assert.match(page, /captureCustomerListAnchor/);
  assert.match(page, /restoreCustomerListAnchor/);
});
