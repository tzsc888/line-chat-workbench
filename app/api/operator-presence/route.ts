import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const OPERATOR_PRESENCE_ID = "PRIMARY";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const selectedCustomerIdRaw = typeof body?.selectedCustomerId === "string" ? body.selectedCustomerId.trim() : "";
    const selectedCustomerId = selectedCustomerIdRaw || null;

    await prisma.operatorPresence.upsert({
      where: { id: OPERATOR_PRESENCE_ID },
      update: {
        selectedCustomerId,
        lastSeenAt: new Date(),
      },
      create: {
        id: OPERATOR_PRESENCE_ID,
        selectedCustomerId,
        lastSeenAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/operator-presence error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
