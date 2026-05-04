import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";

type Props = {
  params: Promise<{ customerId: string; tagId: string }>;
};

export async function DELETE(_: Request, { params }: Props) {
  try {
    const { customerId, tagId } = await params;
    const normalizedTagId = String(tagId || "").trim();

    const [customer, tag] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }),
      prisma.tag.findUnique({ where: { id: normalizedTagId }, select: { id: true } }),
    ]);

    if (!customer) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }
    if (!tag) {
      return NextResponse.json({ ok: false, error: "tag_not_found" }, { status: 404 });
    }

    await prisma.customerTag.deleteMany({
      where: {
        customerId,
        tagId: normalizedTagId,
      },
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
    console.error("DELETE /api/customers/[customerId]/tags/[tagId] error:", error);
    return NextResponse.json({ ok: false, error: "failed_to_update_customer_tags" }, { status: 500 });
  }
}
