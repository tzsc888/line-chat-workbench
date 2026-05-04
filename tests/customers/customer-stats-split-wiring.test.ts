import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("/api/customers list route should not run global unread/followup stats queries", () => {
  const customersRoute = read("app/api/customers/route.ts");
  assert.equal(customersRoute.includes("prisma.customer.aggregate("), false);
  assert.equal(customersRoute.includes("prisma.customer.count("), false);
  assert.equal(customersRoute.includes("stats: null"), true);
});

test("/api/customers/stats route should provide totalUnreadCount and overdueFollowupCount", () => {
  const statsRoute = read("app/api/customers/stats/route.ts");
  assert.match(statsRoute, /prisma\.customer\.aggregate\(/);
  assert.match(statsRoute, /prisma\.customer\.count\(/);
  assert.match(statsRoute, /totalUnreadCount/);
  assert.match(statsRoute, /overdueFollowupCount/);
  assert.equal(statsRoute.includes("failExpiredOutboundTasks"), false);
});

test("page should load stats from dedicated endpoint instead of customers list payload", () => {
  const page = read("app/page.tsx");
  assert.match(page, /fetch\("\/api\/customers\/stats"/);
  assert.equal(page.includes("const nextStats: CustomerListStats = data.stats"), false);
  assert.equal(page.includes("setCustomerStats(nextStats)"), false);
  assert.match(page, /void loadCustomerStats\(\)/);
});
