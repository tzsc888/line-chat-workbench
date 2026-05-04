import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [overdueFollowupCount, unreadAggregate] = await Promise.all([
      prisma.customer.count({
        where: {
          followupState: "ACTIVE",
          nextFollowupAt: {
            lte: new Date(),
          },
        },
      }),
      prisma.customer.aggregate({
        _sum: {
          unreadCount: true,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      stats: {
        totalUnreadCount: unreadAggregate._sum.unreadCount ?? 0,
        overdueFollowupCount,
      },
    });
  } catch (error) {
    console.error("GET /api/customers/stats error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "failed_to_load_customer_stats",
      },
      { status: 500 }
    );
  }
}
