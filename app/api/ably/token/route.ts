import { NextResponse } from "next/server";
import { ablyRest } from "@/lib/ably";

async function handleTokenRequest() {
  try {
    const tokenRequest = await ablyRest.auth.createTokenRequest({
      clientId: "operator-console",
      capability: JSON.stringify({
        "line-chat-workbench": ["subscribe"],
      }),
    });

    return NextResponse.json(tokenRequest);
  } catch (error) {
    console.error("/api/ably/token error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return handleTokenRequest();
}

export async function POST() {
  return handleTokenRequest();
}