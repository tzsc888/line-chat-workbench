import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const customers = await prisma.customer.findMany({
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        messages: {
          orderBy: {
            sentAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: [
        {
          lastMessageAt: "desc",
        },
        {
          updatedAt: "desc",
        },
      ],
    });

    const result = customers.map((customer) => ({
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
      tags: customer.tags.map((item) => ({
        id: item.tag.id,
        name: item.tag.name,
        color: item.tag.color,
      })),
      latestMessage: customer.messages[0]
        ? {
            id: customer.messages[0].id,
            role: customer.messages[0].role,
            type: customer.messages[0].type,
            source: customer.messages[0].source,
            japaneseText: customer.messages[0].japaneseText,
            chineseText: customer.messages[0].chineseText,
            sentAt: customer.messages[0].sentAt,
          }
        : null,
    }));

    return NextResponse.json({
      ok: true,
      customers: result,
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