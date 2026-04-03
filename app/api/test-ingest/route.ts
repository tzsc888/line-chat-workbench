import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  const payload = {
    customerId: "demo-yamada-001",
    originalName: "山田花子",
    noteName: "3/12 新客 高意向",
    avatar: "山",
    japanese: "昨日から夫の態度がさらに冷たくて、本当に離婚になるのか不安です…",
  };

  try {
    const response = await fetch(`${origin}/api/ingest-customer-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "测试接口调用失败",
          detail: text,
        },
        { status: 500 }
      );
    }

    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}