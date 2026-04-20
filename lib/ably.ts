const Ably = require("ably");

import { Prisma, UiRefreshOutboxStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const globalForAbly = globalThis as unknown as {
  ablyRest: any;
};

export type RealtimeRefreshPayload = Record<string, unknown> & {
  customerId?: string | null;
  reason?: string | null;
  scopes?: string[];
};

function createAblyRest() {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 ABLY_API_KEY");
  }

  return new Ably.Rest({
    key: apiKey,
    queryTime: true,
  });
}

export const ablyRest = globalForAbly.ablyRest ?? createAblyRest();

if (process.env.NODE_ENV !== "production") {
  globalForAbly.ablyRest = ablyRest;
}

function sanitizeScopes(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function sanitizePayload(data?: RealtimeRefreshPayload): Prisma.InputJsonObject {
  const payload = {
    ...(data || {}),
  } as Record<string, unknown>;

  if (typeof payload.customerId !== "string" || !payload.customerId.trim()) {
    delete payload.customerId;
  } else {
    payload.customerId = payload.customerId.trim();
  }

  if (typeof payload.reason !== "string" || !payload.reason.trim()) {
    payload.reason = "refresh";
  } else {
    payload.reason = payload.reason.trim();
  }

  const scopes = sanitizeScopes(payload.scopes);
  if (scopes.length) {
    payload.scopes = scopes;
  } else {
    delete payload.scopes;
  }

  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonObject;
}

function computeRetryDelayMs(attemptCount: number) {
  const base = Math.min(60_000, 2_000 * Math.max(1, attemptCount));
  const jitter = Math.floor(Math.random() * 1_500);
  return base + jitter;
}

export async function publishRealtimeRefreshNow(data?: RealtimeRefreshPayload) {
  const payload = sanitizePayload(data);
  await ablyRest.channels.get("line-chat-workbench").publish("refresh", {
    at: Date.now(),
    ...payload,
  });
}

export async function recordRealtimeRefresh(data?: RealtimeRefreshPayload) {
  const payload = sanitizePayload(data);
  return prisma.uiRefreshOutbox.create({
    data: {
      customerId: typeof payload.customerId === "string" ? payload.customerId : null,
      reason: typeof payload.reason === "string" ? payload.reason : "refresh",
      scopes: sanitizeScopes(payload.scopes),
      payload,
      status: UiRefreshOutboxStatus.PENDING,
      nextRetryAt: new Date(),
    },
    select: {
      id: true,
      customerId: true,
      reason: true,
      payload: true,
      status: true,
      attemptCount: true,
    },
  });
}

export async function dispatchRealtimeRefreshOutboxById(id: string) {
  const entry = await prisma.uiRefreshOutbox.findUnique({
    where: { id },
    select: {
      id: true,
      payload: true,
      attemptCount: true,
      status: true,
    },
  });

  if (!entry) {
    return { ok: false, skipped: true, reason: "not-found" } as const;
  }

  if (entry.status === UiRefreshOutboxStatus.DELIVERED) {
    return { ok: true, skipped: true, reason: "already-delivered" } as const;
  }

  try {
    await publishRealtimeRefreshNow((entry.payload || {}) as RealtimeRefreshPayload);
    await prisma.uiRefreshOutbox.update({
      where: { id: entry.id },
      data: {
        status: UiRefreshOutboxStatus.DELIVERED,
        deliveredAt: new Date(),
        attemptCount: { increment: 1 },
        lastError: null,
        nextRetryAt: null,
      },
    });
    return { ok: true, skipped: false } as const;
  } catch (error) {
    const nextRetryAt = new Date(Date.now() + computeRetryDelayMs(entry.attemptCount + 1));
    await prisma.uiRefreshOutbox.update({
      where: { id: entry.id },
      data: {
        status: UiRefreshOutboxStatus.FAILED,
        attemptCount: { increment: 1 },
        lastError: error instanceof Error ? error.message : String(error),
        nextRetryAt,
      },
    });
    throw error;
  }
}

export async function dispatchPendingRealtimeRefreshOutbox(limit = 50) {
  const dueEntries = await prisma.uiRefreshOutbox.findMany({
    where: {
      status: { in: [UiRefreshOutboxStatus.PENDING, UiRefreshOutboxStatus.FAILED] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: [{ createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });

  const results: Array<{ id: string; status: string }> = [];
  for (const entry of dueEntries) {
    try {
      await dispatchRealtimeRefreshOutboxById(entry.id);
      results.push({ id: entry.id, status: "DELIVERED" });
    } catch {
      results.push({ id: entry.id, status: "FAILED" });
    }
  }

  return {
    scanned: dueEntries.length,
    results,
  };
}

export async function publishRealtimeRefresh(data?: RealtimeRefreshPayload) {
  const entry = await recordRealtimeRefresh(data);
  try {
    await dispatchRealtimeRefreshOutboxById(entry.id);
  } catch (error) {
    console.error("publishRealtimeRefresh dispatch error:", error);
  }
  return entry;
}
