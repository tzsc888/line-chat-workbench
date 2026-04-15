import { NextResponse } from "next/server";
import { ingestCustomerMessage } from "@/lib/services/ingest-customer-message";

export async function GET() {
  const payload = {
    customerId: "demo-yamada-001",
    originalName: "山田花子",
    noteName: "3/12 新客 高意向",
    avatar: "山",
    japanese: "昨日から夫の態度がさらに冷たくて、本当に離婚になるのか不安です…",
  };

  try {
    const result = await ingestCustomerMessage(payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 },
    );
  }
}
