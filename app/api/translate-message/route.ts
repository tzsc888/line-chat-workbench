import { NextRequest, NextResponse } from "next/server";
import { translateJapaneseToChinese } from "@/lib/translate";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const japanese = typeof body.japanese === "string" ? body.japanese : "";
    console.info("[manual-translation-api] request", {
      textLength: japanese.trim().length,
    });

    if (!japanese.trim()) {
      return NextResponse.json({ ok: false, error: "MISSING_JAPANESE_TEXT" }, { status: 400 });
    }

    const result = await translateJapaneseToChinese(japanese);
    const chinese = String(result.chinese || "").trim();
    if (!chinese) {
      return NextResponse.json({ ok: false, error: "TRANSLATION_EMPTY" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      line: result.line,
      model: result.model,
      chinese,
    });
  } catch (error) {
    console.error("[manual-translation-api] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: "TRANSLATION_FAILED",
        detail: message || "unknown_error",
      },
      { status: 500 },
    );
  }
}
