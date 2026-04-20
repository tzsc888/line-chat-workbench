import test from "node:test";
import assert from "node:assert/strict";
import { LineRelationshipStatus } from "@prisma/client";
import { computeLineRefollowedAt } from "../../lib/customers/relationship-transition";

test("bridge create ACTIVE customer => lineRefollowedAt is null", () => {
  const now = new Date("2026-04-20T00:00:00.000Z");
  const next = computeLineRefollowedAt({
    previousStatus: null,
    nextStatus: LineRelationshipStatus.ACTIVE,
    now,
    isCreate: true,
  });
  assert.equal(next, null);
});

test("bridge update ACTIVE -> ACTIVE => lineRefollowedAt unchanged", () => {
  const now = new Date("2026-04-20T00:00:00.000Z");
  const next = computeLineRefollowedAt({
    previousStatus: LineRelationshipStatus.ACTIVE,
    nextStatus: LineRelationshipStatus.ACTIVE,
    previousLineRefollowedAt: new Date("2026-04-01T00:00:00.000Z"),
    now,
    isCreate: false,
  });
  assert.equal(next, undefined);
});

test("bridge update UNFOLLOWED -> ACTIVE => lineRefollowedAt set now", () => {
  const now = new Date("2026-04-20T00:00:00.000Z");
  const next = computeLineRefollowedAt({
    previousStatus: LineRelationshipStatus.UNFOLLOWED,
    nextStatus: LineRelationshipStatus.ACTIVE,
    now,
    isCreate: false,
  });
  assert.equal(next, now);
});

test("line webhook first follow for new customer => lineRefollowedAt is null", () => {
  const now = new Date("2026-04-20T00:00:00.000Z");
  const next = computeLineRefollowedAt({
    previousStatus: null,
    nextStatus: LineRelationshipStatus.ACTIVE,
    now,
    isCreate: true,
  });
  assert.equal(next, null);
});

test("line webhook unfollow then follow for existing customer => lineRefollowedAt set now", () => {
  const now = new Date("2026-04-20T00:00:00.000Z");
  const next = computeLineRefollowedAt({
    previousStatus: LineRelationshipStatus.UNFOLLOWED,
    nextStatus: LineRelationshipStatus.ACTIVE,
    now,
    isCreate: false,
  });
  assert.equal(next, now);
});
