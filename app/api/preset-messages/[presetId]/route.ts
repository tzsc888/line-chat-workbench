import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Props = {
  params: Promise<{ presetId: string }>;
};

export async function PATCH(req: Request, { params }: Props) {
  try {
    const { presetId } = await params;
    const body = await req.json();
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();

    if (!title) {
      return NextResponse.json({ ok: false, error: "名称不能为空" }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ ok: false, error: "内容不能为空" }, { status: 400 });
    }

    const item = await prisma.presetSnippet.update({
      where: { id: presetId },
      data: { title, content },
    });

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error("PATCH /api/preset-messages/[presetId] error:", error);
    return NextResponse.json({ ok: false, error: "更新预设信息失败" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: Props) {
  try {
    const { presetId } = await params;

    await prisma.presetSnippet.delete({
      where: { id: presetId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/preset-messages/[presetId] error:", error);
    return NextResponse.json({ ok: false, error: "删除预设信息失败" }, { status: 500 });
  }
}
