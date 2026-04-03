import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function GET(_: Request, { params }: Props) {
  try {
    const { customerId } = await params;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        messages: {
          orderBy: {
            sentAt: "asc",
          },
          take: 100,
        },
        replyDraftSets: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!customer) {
      return NextResponse.json(
        {
          ok: false,
          error: "客户不存在",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      workspace: {
        customer: {
          id: customer.id,
          lineUserId: customer.lineUserId,
          remarkName: customer.remarkName,
          originalName: customer.originalName,
          avatarUrl: customer.avatarUrl,
          stage: customer.stage,
          isVip: customer.isVip,
          aiCustomerInfo: customer.aiCustomerInfo,
          aiCurrentStrategy: customer.aiCurrentStrategy,
          aiLastAnalyzedAt: customer.aiLastAnalyzedAt,
          lastMessageAt: customer.lastMessageAt,
        },
        tags: customer.tags.map((item) => ({
          id: item.tag.id,
          name: item.tag.name,
          color: item.tag.color,
        })),
        messages: customer.messages,
        latestReplyDraftSet: customer.replyDraftSets[0] ?? null,
      },
    });
  } catch (error) {
    console.error("GET /api/customers/[customerId]/workspace error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "读取顾客工作台失败",
      },
      { status: 500 }
    );
  }
}