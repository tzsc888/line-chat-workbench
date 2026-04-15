import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function PATCH(req: NextRequest, { params }: Props) {
  try {
    const { customerId } = await params;
    const body = await req.json();

    const data: {
      followupBucket?: "UNCONVERTED" | "VIP" | null;
      followupTier?: "A" | "B" | "C" | null;
      followupState?: "ACTIVE" | "OBSERVING" | "WAITING_WINDOW" | "POST_PURCHASE_CARE" | "DONE" | "PAUSED";
      nextFollowupBucket?: "IMMEDIATE" | "TODAY" | "IN_1_DAY" | "IN_3_DAYS" | "IN_7_DAYS" | "NO_SET" | null;
      nextFollowupAt?: Date | null;
      followupReason?: string | null;
      lastFollowupHandledAt?: Date | null;
      followupUpdatedAt?: Date | null;
    } = {};

    if (body.bucket === "UNCONVERTED" || body.bucket === "VIP") {
      data.followupBucket = body.bucket;
    }

    if (body.tier === "A" || body.tier === "B" || body.tier === "C") {
      data.followupTier = body.tier;
    }

    if (["ACTIVE", "OBSERVING", "WAITING_WINDOW", "POST_PURCHASE_CARE", "DONE", "PAUSED"].includes(body.state)) {
      data.followupState = body.state;
    }

    if (Object.prototype.hasOwnProperty.call(body, "nextFollowupBucket")) {
      const nextBucket = typeof body.nextFollowupBucket === "string" ? body.nextFollowupBucket.trim() : "";
      if (["IMMEDIATE", "TODAY", "IN_1_DAY", "IN_3_DAYS", "IN_7_DAYS", "NO_SET"].includes(nextBucket)) {
        data.nextFollowupBucket = nextBucket as typeof data.nextFollowupBucket;
      } else {
        data.nextFollowupBucket = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "nextFollowupAt")) {
      data.nextFollowupAt = body.nextFollowupAt ? new Date(body.nextFollowupAt) : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, "reason")) {
      const nextReason = String(body.reason ?? "").trim();
      data.followupReason = nextReason || null;
    }

    if (body.markHandled === true) {
      data.followupState = "DONE";
      data.nextFollowupAt = null;
      data.lastFollowupHandledAt = new Date();
    }

    if (body.reactivate === true) {
      data.followupState = "ACTIVE";
    }

    data.followupUpdatedAt = new Date();

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data,
      select: {
        id: true,
        followupBucket: true,
        followupTier: true,
        followupState: true,
        nextFollowupBucket: true,
        nextFollowupAt: true,
        followupReason: true,
        lastFollowupHandledAt: true,
        followupUpdatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, customer: updated });
  } catch (error) {
    console.error("PATCH /api/followups/[customerId] error:", error);
    return NextResponse.json({ ok: false, error: "更新跟进信息失败" }, { status: 500 });
  }
}
