import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { translateInboundMessageImmediately } from "@/lib/inbound-automation";
import { customerListSelect, mapCustomerListItem, type CustomerListRow } from "./customer-list-shared";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type RegularCursor = {
  lastMessageAt: string | null;
  id: string;
};
type RegularCursorParseResult =
  | { ok: true; cursor: RegularCursor | null }
  | { ok: false };

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function buildSearchWhere(keyword: string) {
  return {
    OR: [
      { remarkName: { contains: keyword, mode: "insensitive" as const } },
      { originalName: { contains: keyword, mode: "insensitive" as const } },
      {
        tags: {
          some: {
            tag: {
              name: { contains: keyword, mode: "insensitive" as const },
            },
          },
        },
      },
      {
        messages: {
          some: {
            OR: [
              { japaneseText: { contains: keyword, mode: "insensitive" as const } },
              { chineseText: { contains: keyword, mode: "insensitive" as const } },
            ],
          },
        },
      },
    ],
  };
}

function encodeRegularCursor(cursor: RegularCursor | null) {
  if (!cursor) return null;
  return `${cursor.lastMessageAt ?? "null"}|${cursor.id}`;
}

function isIsoUtcDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
}

function decodeRegularCursor(raw: string | null): RegularCursorParseResult {
  if (!raw) return { ok: true, cursor: null };
  if (!raw.includes("|")) return { ok: false };
  const parts = raw.split("|");
  if (parts.length !== 2) return { ok: false };
  const [rawLastMessageAt, rawId] = parts;
  const id = (rawId || "").trim();
  if (!id) return { ok: false };
  if ((rawLastMessageAt || "").trim().toLowerCase() === "null") {
    return { ok: true, cursor: { lastMessageAt: null, id } };
  }
  const lastMessageAt = (rawLastMessageAt || "").trim();
  if (!lastMessageAt) return { ok: false };
  if (!isIsoUtcDateString(lastMessageAt)) return { ok: false };
  const parsed = new Date(lastMessageAt);
  if (!Number.isFinite(parsed.getTime())) return { ok: false };
  return { ok: true, cursor: { lastMessageAt: parsed.toISOString(), id } };
}

function buildRegularCursorWhere(cursor: RegularCursor | null): Prisma.CustomerWhereInput {
  if (!cursor) return { pinnedAt: null };
  if (!cursor.lastMessageAt) {
    return {
      pinnedAt: null,
      AND: [
        { lastMessageAt: null },
        { id: { lt: cursor.id } },
      ],
    };
  }
  return {
    pinnedAt: null,
    OR: [
      { lastMessageAt: { lt: new Date(cursor.lastMessageAt) } },
      {
        AND: [
          { lastMessageAt: new Date(cursor.lastMessageAt) },
          { id: { lt: cursor.id } },
        ],
      },
      { lastMessageAt: null },
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    const page = parsePositiveInt(req.nextUrl.searchParams.get("page"), 1);
    const limit = Math.min(parsePositiveInt(req.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const keyword = req.nextUrl.searchParams.get("q")?.trim() || "";
    const debugCustomerIdQuery = req.nextUrl.searchParams.get("debugCustomerId")?.trim() || "";
    const debugCustomerIdEnv = process.env.DEBUG_CUSTOMER_ID?.trim() || "";
    const debugCustomerId = debugCustomerIdQuery || debugCustomerIdEnv;
    const rawCursor = req.nextUrl.searchParams.get("cursor");
    const cursorParsed = decodeRegularCursor(rawCursor);
    const isSearching = !!keyword;
    if (!isSearching && !cursorParsed.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_cursor",
        },
        { status: 400 }
      );
    }
    const cursor = cursorParsed.ok ? cursorParsed.cursor : null;
    const hasCursor = !!cursor;
    const skip = Math.max(0, (page - 1) * limit);
    const now = Date.now();

    let customers: CustomerListRow[] = [];
    let hasMore = false;
    let nextCursor: string | null = null;

    if (isSearching) {
      const items = await prisma.customer.findMany({
        where: buildSearchWhere(keyword),
        orderBy: [
          { pinnedAt: "desc" },
          { lastMessageAt: { sort: "desc", nulls: "last" } },
          { id: "desc" },
        ],
        skip,
        take: limit + 1,
        select: customerListSelect,
      });
      hasMore = items.length > limit;
      customers = items.slice(0, limit);
    } else {
      const pinnedCustomers =
        !hasCursor
          ? await prisma.customer.findMany({
              where: {
                pinnedAt: {
                  not: null,
                },
              },
              orderBy: [
                { pinnedAt: "desc" },
                { lastMessageAt: { sort: "desc", nulls: "last" } },
                { id: "desc" },
              ],
              select: customerListSelect,
            })
          : [];

      const regularRows = await prisma.customer.findMany({
        where: buildRegularCursorWhere(cursor),
        orderBy: [
          { lastMessageAt: { sort: "desc", nulls: "last" } },
          { id: "desc" },
        ],
        take: limit + 1,
        select: customerListSelect,
      });

      hasMore = regularRows.length > limit;
      const regularCustomers = regularRows.slice(0, limit);
      const lastRegular = regularCustomers[regularCustomers.length - 1] || null;
      nextCursor = hasMore && lastRegular
        ? encodeRegularCursor({
            lastMessageAt: lastRegular.lastMessageAt ? lastRegular.lastMessageAt.toISOString() : null,
            id: lastRegular.id,
          })
        : null;
      customers = [...pinnedCustomers, ...regularCustomers];
    }

    const mappedCustomers = customers.map((customer) => mapCustomerListItem(customer, now));
    const inboundTranslationCandidates = mappedCustomers
      .filter((customer) => {
        const latest = customer.latestMessage;
        if (!latest) return false;
        if (latest.role !== "CUSTOMER" || latest.type !== "TEXT") return false;
        if (latest.chineseText && latest.chineseText.trim()) return false;
        return !!latest.japaneseText.trim();
      })
      .slice(0, 3);
    if (inboundTranslationCandidates.length > 0) {
      void Promise.allSettled(
        inboundTranslationCandidates.map((customer) => {
          const latest = customer.latestMessage;
          if (!latest) return Promise.resolve({ ok: true } as const);
          return translateInboundMessageImmediately({
            customerId: customer.id,
            messageId: latest.id,
            reason: "customers-list-fallback",
          });
        })
      );
    }
    if (process.env.NODE_ENV !== "production" && debugCustomerId) {
      for (const customer of mappedCustomers) {
        if (customer.id === debugCustomerId) {
          console.info("[customers-api] unread-source", {
            customerId: customer.id,
            unreadCount: customer.unreadCount,
            source: "customer.unreadCount",
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      customers: mappedCustomers,
      hasMore,
      nextCursor,
      page,
      pageSize: limit,
      stats: null,
    });
  } catch (error) {
    console.error("GET /api/customers error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "读取顾客列表失败",
      },
      { status: 500 }
    );
  }
}
