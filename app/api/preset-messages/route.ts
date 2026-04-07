import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const items = await prisma.presetSnippet.findMany({
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("GET /api/preset-messages error:", error);
    return NextResponse.json({ ok: false, error: "读取预设信息失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();

    if (!title) {
      return NextResponse.json({ ok: false, error: "名称不能为空" }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ ok: false, error: "内容不能为空" }, { status: 400 });
    }

    const maxSort = await prisma.presetSnippet.aggregate({
      _max: { sortOrder: true },
    });

    const item = await prisma.presetSnippet.create({
      data: {
        title,
        content,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error("POST /api/preset-messages error:", error);
    return NextResponse.json({ ok: false, error: "创建预设信息失败" }, { status: 500 });
  }
}
