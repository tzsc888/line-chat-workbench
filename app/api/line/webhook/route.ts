import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { publishRealtimeRefresh } from "@/lib/ably";
import { runInboundAutomation } from "@/lib/inbound-automation";

function verifyLineSignature(body: string, signature: string, secret: string) {
  const hash = crypto.createHmac("sha256", secret).update(body).digest("base64");
  return hash === signature;
}

async function getLineProfile(userId: string) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) return null;

  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!channelSecret) {
      return NextResponse.json({ ok: false, error: "缺少 LINE_CHANNEL_SECRET" }, { status: 500 });
    }

    const signature = req.headers.get("x-line-signature") || "";
    const bodyText = await req.text();

    if (!verifyLineSignature(bodyText, signature, channelSecret)) {
      return NextResponse.json({ ok: false, error: "LINE 签名校验失败" }, { status: 401 });
    }

    const body = JSON.parse(bodyText);
    const events = Array.isArray(body.events) ? body.events : [];
    const internalBaseUrl = process.env.INTERNAL_APP_BASE_URL || "http://127.0.0.1:3000";

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;
      if (event.source?.type !== "user") continue;

      const userId = String(event.source.userId || "").trim();
      const japanese = String(event.message.text || "").trim();
      const lineMessageId = String(event.message.id || "").trim();

      if (!userId || !japanese) continue;

      const profile = await getLineProfile(userId);
      const originalName =
        typeof profile?.displayName === "string" && profile.displayName.trim()
          ? profile.displayName.trim()
          : userId;
      const avatar = typeof profile?.pictureUrl === "string" ? profile.pictureUrl : "";

      let ingestJson: any = null;

      try {
        const ingestResponse = await fetch(`${internalBaseUrl}/api/ingest-customer-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: userId,
            originalName,
            noteName: "",
            avatar,
            japanese,
            lineMessageId,
            skipTranslate: true,
          }),
        });

        ingestJson = await ingestResponse.json();
      } catch (error) {
        console.error("LINE ingest fetch error:", error);
        continue;
      }

      if (!ingestJson?.ok || !ingestJson?.customer?.id || !ingestJson?.message?.id) {
        continue;
      }

      const customerId = String(ingestJson.customer.id);
      const messageId = String(ingestJson.message.id);

      try {
        await publishRealtimeRefresh({ customerId, reason: "inbound-message" });
      } catch (error) {
        console.error("Ably publish inbound-message error:", error);
      }

      after(async () => {
        await runInboundAutomation({
          customerId,
          targetMessageId: messageId,
          internalBaseUrl,
        });
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/line/webhook error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
