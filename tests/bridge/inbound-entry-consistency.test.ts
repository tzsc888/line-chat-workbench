import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("bridge/line/ingest routes should share first-inbound trigger policy wiring", () => {
  const bridgeRoute = read("app/api/bridge/inbound/route.ts");
  const lineRoute = read("app/api/line/webhook/route.ts");
  const ingestRoute = read("app/api/ingest-customer-message/route.ts");

  for (const source of [bridgeRoute, lineRoute, ingestRoute]) {
    assert.match(source, /import\s+\{\s*decideInboundTriggerPolicy\s*\}\s+from\s+"@\/lib\/inbound\/trigger-policy"/);
    assert.match(source, /import\s+\{\s*isFirstInboundTextMessage\s*\}\s+from\s+"@\/lib\/inbound\/first-inbound"/);
    assert.match(source, /decideInboundTriggerPolicy\(/);
    assert.match(source, /isFirstInboundTextMessage\(/);
    assert.match(source, /shouldQueueWorkflow/);
  }
});

test("analyze route is removed in generation-only pipeline", () => {
  const target = path.resolve(process.cwd(), "app/api/analyze-customer/route.ts");
  assert.equal(fs.existsSync(target), false);
});

test("bridge and line webhook should share relationship transition helper", () => {
  const bridgeRoute = read("app/api/bridge/inbound/route.ts");
  const lineRoute = read("app/api/line/webhook/route.ts");

  for (const source of [bridgeRoute, lineRoute]) {
    assert.match(source, /import\s+\{\s*computeLineRefollowedAt\s*\}\s+from\s+"@\/lib\/customers\/relationship-transition"/);
    assert.match(source, /computeLineRefollowedAt\(/);
  }
});
