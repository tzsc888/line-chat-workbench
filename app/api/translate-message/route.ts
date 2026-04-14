import { NextRequest, NextResponse } from "next/server";
import { translateJapaneseToChinese } from "@/lib/translate";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const japanese = typeof body.japanese === "string" ? body.japanese : "";

    if (!japanese.trim()) {
      return NextResponse.json({ ok: false, error: "缺少日语内容" }, { status: 400 });
    }

    const result = await translateJapaneseToChinese(japanese);

    return NextResponse.json({
      ok: true,
      line: result.line,
      model: result.model,
      chinese: result.chinese,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    try {
      const parsed = JSON.parse(message);
      return NextResponse.json({ ok: false, ...parsed }, { status: 500 });
    } catch {
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
}
