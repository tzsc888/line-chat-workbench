import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("customers and workspace GET routes should not call failExpiredOutboundTasks", () => {
  const customersRoute = read("app/api/customers/route.ts");
  const workspaceRoute = read("app/api/customers/[customerId]/workspace/route.ts");

  assert.equal(customersRoute.includes("failExpiredOutboundTasks"), false);
  assert.equal(workspaceRoute.includes("failExpiredOutboundTasks"), false);
});

test("maintenance cron route should call failExpiredOutboundTasks with explicit limit", () => {
  const maintenanceRoute = read("app/api/cron/maintenance/route.ts");

  assert.match(maintenanceRoute, /import\s+\{\s*failExpiredOutboundTasks\s*\}\s+from\s+"@\/lib\/bridge-outbound"/);
  assert.match(maintenanceRoute, /failExpiredOutboundTasks\(\{\s*limit:\s*50\s*\}\)/);
  assert.match(maintenanceRoute, /Promise\.allSettled\(/);
  assert.equal(maintenanceRoute.includes("ENABLE_LEGACY_CRON_MAINTENANCE"), false);
  assert.equal(maintenanceRoute.includes("legacyEndpointDisabledResponse"), false);
});

test("failExpiredOutboundTasks should apply bounded batch size and timeout reason", () => {
  const outboundLib = read("lib/bridge-outbound.ts");

  assert.match(outboundLib, /DEFAULT_FAIL_EXPIRED_OUTBOUND_TASKS_LIMIT\s*=\s*50/);
  assert.match(outboundLib, /take:\s*limit/);
  assert.match(outboundLib, /orderBy:\s*\[\s*\{\s*updatedAt:\s*"asc"\s*\},\s*\{\s*id:\s*"asc"\s*\}\s*\]/);
  assert.match(outboundLib, /for\s*\(const task of expiredTasks\)\s*\{\s*try\s*\{/s);
  assert.match(outboundLib, /catch\s*\(error\)\s*\{/);
  assert.match(outboundLib, /processed \+= 1/);
  assert.match(outboundLib, /failed \+= 1/);
  assert.match(outboundLib, /errors\.push\(\{ taskId: task\.id, error: errorText \}\)/);
  assert.match(outboundLib, /publishCustomerRefresh\(task\.customerId,\s*"bridge-outbound-timeout"\)/);
});

test("hobby external scheduler docs and maintenance auth should stay configured", () => {
  const vercelConfigRaw = read("vercel.json");
  const vercelConfig = JSON.parse(vercelConfigRaw) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const readme = read("README.md");
  const maintenanceRoute = read("app/api/cron/maintenance/route.ts");

  assert.equal(typeof vercelConfigRaw, "string");
  assert.equal(vercelConfigRaw.includes("\"$schema\""), true);
  assert.equal(Array.isArray(vercelConfig.crons), false, "vercel.json should not define built-in crons on Hobby strategy");

  assert.match(readme, /\/api\/cron\/maintenance/);
  assert.match(readme, /\/api\/bridge\/scheduled-messages\/dispatch/);
  assert.match(readme, /CRON_SECRET|Authorization:\s*Bearer/i);
  assert.match(readme, /BRIDGE_SHARED_SECRET|x-bridge-secret/i);

  assert.match(maintenanceRoute, /process\.env\.CRON_SECRET/);
  assert.match(maintenanceRoute, /authorization/);
  assert.match(maintenanceRoute, /x-cron-secret/);
});
