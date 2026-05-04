import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";

type Props = {
  params: Promise<{ tagId: string }>;
};

const PER_CUSTOMER_PUBLISH_LIMIT = 50;

export async function DELETE(_: Request, { params }: Props) {
  try {
    const { tagId } = await params;
    const normalizedTagId = String(tagId || "").trim();
    if (!normalizedTagId) {
      return NextResponse.json({ ok: false, error: "invalid_tag_id" }, { status: 400 });
    }

    const existingTag = await prisma.tag.findUnique({
      where: { id: normalizedTagId },
      select: { id: true },
    });
    if (!existingTag) {
      return NextResponse.json({ ok: false, error: "tag_not_found" }, { status: 404 });
    }

    const affectedCustomerRows = await prisma.customerTag.findMany({
      where: { tagId: normalizedTagId },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    const affectedCustomerIds = affectedCustomerRows.map((row) => row.customerId).filter(Boolean);

    await prisma.$transaction(async (tx) => {
      await tx.customerTag.deleteMany({
        where: { tagId: normalizedTagId },
      });
      await tx.tag.delete({
        where: { id: normalizedTagId },
      });
    });

    if (affectedCustomerIds.length <= PER_CUSTOMER_PUBLISH_LIMIT) {
      try {
        await Promise.all(
          affectedCustomerIds.map((customerId) =>
            publishRealtimeRefresh({
              customerId,
              reason: "customer-tags-updated",
            })
          )
        );
      } catch (error) {
        console.error("Ably publish customer-tags-updated on tag delete error:", error);
      }
    }

    try {
      await publishRealtimeRefresh({
        reason: "tags-updated",
        tagId: normalizedTagId,
      });
    } catch (error) {
      console.error("Ably publish tag delete refresh error:", error);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/tags/[tagId] error:", error);
    return NextResponse.json({ ok: false, error: "failed_to_delete_tag" }, { status: 500 });
  }
}
