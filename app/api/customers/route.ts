import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function getLatestPreview(message: {
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE";
  japaneseText: string;
}) {
  const baseText = message.type === "IMAGE" ? "[图片]" : message.japaneseText.trim();
  return `${message.role === "OPERATOR" ? "我：" : ""}${baseText}`;
}

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
    });

    const sorted = [...customers].sort((a, b) => {
      const aPinned = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bPinned = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;

      if (aPinned || bPinned) {
        if (!aPinned) return 1;
        if (!bPinned) return -1;
        if (bPinned !== aPinned) return bPinned - aPinned;
      }

      const aLast = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bLast = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (bLast !== aLast) return bLast - aLast;

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const result = sorted.map((customer) => {
      const latestMessage = customer.messages[0] || null;

      return {
        id: customer.id,
        lineUserId: customer.lineUserId,
        remarkName: customer.remarkName,
        originalName: customer.originalName,
        avatarUrl: customer.avatarUrl,
        stage: customer.stage,
        isVip: customer.isVip,
        pinnedAt: customer.pinnedAt,
        unreadCount: customer.unreadCount,
        aiCustomerInfo: customer.aiCustomerInfo,
        aiCurrentStrategy: customer.aiCurrentStrategy,
        aiLastAnalyzedAt: customer.aiLastAnalyzedAt,
        lastMessageAt: customer.lastMessageAt,
        tags: customer.tags.map((item) => ({
          id: item.tag.id,
          name: item.tag.name,
          color: item.tag.color,
        })),
        latestMessage: latestMessage
          ? {
              id: latestMessage.id,
              role: latestMessage.role,
              type: latestMessage.type,
              source: latestMessage.source,
              japaneseText: latestMessage.japaneseText,
              chineseText: latestMessage.chineseText,
              sentAt: latestMessage.sentAt,
              previewText: getLatestPreview({
                role: latestMessage.role,
                type: latestMessage.type,
                japaneseText: latestMessage.japaneseText,
              }),
            }
          : null,
      };
    });

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
