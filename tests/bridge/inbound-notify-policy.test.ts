import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBridgeInboundMode,
  resolveBridgeInboundNotifyPolicy,
} from "../../lib/bridge/inbound-notify-policy";

test("live inbound defaults to sound-eligible refresh reason", () => {
  const mode = normalizeBridgeInboundMode("live");
  const policy = resolveBridgeInboundNotifyPolicy({ mode });
  assert.equal(mode, "live");
  assert.equal(policy.shouldNotifyInboundSound, true);
  assert.equal(policy.inboundRefreshReason, "bridge-inbound-message");
});

test("non-live inbound defaults to silent history refresh reason", () => {
  const mode = normalizeBridgeInboundMode("history");
  const policy = resolveBridgeInboundNotifyPolicy({ mode });
  assert.equal(mode, "non_live");
  assert.equal(policy.shouldNotifyInboundSound, false);
  assert.equal(policy.inboundRefreshReason, "bridge-inbound-history");
});

test("notify=false forces silent history reason even in live mode", () => {
  const mode = normalizeBridgeInboundMode("live");
  const policy = resolveBridgeInboundNotifyPolicy({ mode, notify: false });
  assert.equal(policy.shouldNotifyInboundSound, false);
  assert.equal(policy.inboundRefreshReason, "bridge-inbound-history");
});

