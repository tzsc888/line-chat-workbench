import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const { customerId } = await params;
    const body = await req.json();
    if (typeof body?.tagId !== "string") {
      return NextResponse.json({ ok: false, error: "invalid_tag_id" }, { status: 400 });
    }
    const tagId = body.tagId.trim();
    if (!tagId) {
      return NextResponse.json({ ok: false, error: "invalid_tag_id" }, { status: 400 });
    }

    const [customer, tag] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }),
      prisma.tag.findUnique({ where: { id: tagId }, select: { id: true } }),
    ]);

    if (!customer) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }
    if (!tag) {
      return NextResponse.json({ ok: false, error: "tag_not_found" }, { status: 404 });
    }

    await prisma.customerTag.upsert({
      where: {
        customerId_tagId: {
          customerId,
          tagId,
        },
      },
      create: {
        customerId,
        tagId,
      },
      update: {},
    });

    try {
      await publishRealtimeRefresh({
        customerId,
        reason: "customer-tags-updated",
      });
    } catch (error) {
      console.error("Ably publish customer-tags-updated error:", error);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/customers/[customerId]/tags error:", error);
    return NextResponse.json({ ok: false, error: "failed_to_update_customer_tags" }, { status: 500 });
  }
}
