import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken } from "../../lib/security/session.ts";

test("session token round-trip verifies successfully", async () => {
  const token = await createSessionToken("alice", "super-secret", 60);
  const payload = await verifySessionToken(token, "super-secret");
  assert.equal(payload?.sub, "alice");
  assert.equal(payload?.v, 1);
  assert.ok((payload?.exp || 0) > Date.now());
});

test("session token verification fails with wrong secret", async () => {
  const token = await createSessionToken("alice", "super-secret", 60);
  const payload = await verifySessionToken(token, "another-secret");
  assert.equal(payload, null);
});
