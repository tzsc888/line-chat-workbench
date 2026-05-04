import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CUSTOMER_TAG_LIMIT,
  isValidTagName,
  normalizeTagName,
  pickNextTagColor,
} from "@/lib/customer-tags";

export async function GET() {
  try {
    const tags = await prisma.tag.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        color: true,
        sortOrder: true,
      },
    });

    return NextResponse.json({
      ok: true,
      tags,
    });
  } catch (error) {
    console.error("GET /api/tags error:", error);
    return NextResponse.json({ ok: false, error: "failed_to_load_tags" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = normalizeTagName(body?.name);
    if (!isValidTagName(name)) {
      return NextResponse.json({ ok: false, error: "invalid_tag_name" }, { status: 400 });
    }

    const MAX_RETRIES_ON_P2034 = 2;
    let created:
      | { ok: true; tag: { id: string; name: string; color: string | null; sortOrder: number } }
      | { ok: false; error: "tag_limit_reached" | "tag_name_exists" }
      | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES_ON_P2034; attempt += 1) {
      try {
        created = await prisma.$transaction(
          async (tx) => {
            const existingTags = await tx.tag.findMany({
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                name: true,
                color: true,
                sortOrder: true,
              },
            });

            if (existingTags.length >= CUSTOMER_TAG_LIMIT) {
              return { ok: false as const, error: "tag_limit_reached" as const };
            }

            const duplicate = existingTags.find(
              (item) => item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
            );
            if (duplicate) {
              return { ok: false as const, error: "tag_name_exists" as const };
            }

            const maxSortOrder = existingTags.reduce((max, item) => Math.max(max, item.sortOrder), -1);
            const nextSortOrder = maxSortOrder + 1;
            const nextColor = pickNextTagColor(existingTags.map((item) => item.color || ""));

            const tag = await tx.tag.create({
              data: {
                name,
                color: nextColor,
                sortOrder: nextSortOrder,
              },
              select: {
                id: true,
                name: true,
                color: true,
                sortOrder: true,
              },
            });

            return { ok: true as const, tag };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < MAX_RETRIES_ON_P2034
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new Error("create_tag_retry_exhausted");
    }

    if (!created.ok) {
      const status = created.error === "tag_name_exists" ? 409 : 400;
      return NextResponse.json({ ok: false, error: created.error }, { status });
    }

    return NextResponse.json({
      ok: true,
      tag: created.tag,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json({ ok: false, error: "tag_name_exists" }, { status: 409 });
      }
    }
    console.error("POST /api/tags error:", error);
    return NextResponse.json({ ok: false, error: "failed_to_create_tag" }, { status: 500 });
  }
}
