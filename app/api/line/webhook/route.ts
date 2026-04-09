import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
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

async function getLineMessageContent(messageId: string) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  }

  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`读取 LINE 消息内容失败: HTTP ${response.status} - ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

function getExtByContentType(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

async function uploadInboundImageToBlob(params: {
  customerId: string;
  lineMessageId: string;
  contentType: string;
  buffer: Buffer;
}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return null;
  }

  const ext = getExtByContentType(params.contentType);
  const blob = await put(
    `line-inbound/${params.customerId}/${params.lineMessageId}.${ext}`,
    params.buffer,
    {
      access: "public",
      addRandomSuffix: false,
      contentType: params.contentType,
    }
  );

  return blob.url;
}

async function markCustomerRelationshipStatus(lineUserId: string, status: "ACTIVE" | "UNFOLLOWED", options?: {
  originalName?: string;
  avatarUrl?: string;
  refollowed?: boolean;
}) {
  const now = new Date();

  const existing = await prisma.customer.findUnique({
    where: { lineUserId },
    select: { id: true },
  });

  if (existing) {
    await prisma.customer.update({
      where: { id: existing.id },
      data: {
        lineRelationshipStatus: status,
        lineRelationshipUpdatedAt: now,
        lineRefollowedAt: options?.refollowed ? now : null,
        originalName: options?.originalName || undefined,
        avatarUrl: options?.avatarUrl || undefined,
      },
    });

    try {
      await publishRealtimeRefresh({ customerId: existing.id, reason: status === "UNFOLLOWED" ? "line-unfollow" : "line-follow" });
    } catch (error) {
      console.error("Ably publish relationship status error:", error);
    }

    return;
  }

  if (status === "ACTIVE") {
    const created = await prisma.customer.create({
      data: {
        lineUserId,
        originalName: options?.originalName || lineUserId,
        avatarUrl: options?.avatarUrl || null,
        lineRelationshipStatus: "ACTIVE",
        lineRelationshipUpdatedAt: now,
        lineRefollowedAt: options?.refollowed ? now : null,
      },
      select: { id: true },
    });

    try {
      await publishRealtimeRefresh({ customerId: created.id, reason: "line-follow" });
    } catch (error) {
      console.error("Ably publish relationship status error:", error);
    }
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
      if (event.source?.type !== "user") continue;

      const userId = String(event.source.userId || "").trim();
      if (!userId) continue;

      if (event.type === "unfollow") {
        await markCustomerRelationshipStatus(userId, "UNFOLLOWED");
        continue;
      }

      if (event.type === "follow") {
        const profile = await getLineProfile(userId);
        await markCustomerRelationshipStatus(userId, "ACTIVE", {
          originalName:
            typeof profile?.displayName === "string" && profile.displayName.trim()
              ? profile.displayName.trim()
              : userId,
          avatarUrl: typeof profile?.pictureUrl === "string" ? profile.pictureUrl : "",
          refollowed: true,
        });
        continue;
      }

      if (event.type !== "message") continue;

      const lineType = String(event.message?.type || "").trim();
      if (!["text", "image", "sticker"].includes(lineType)) continue;

      const lineMessageId = String(event.message?.id || "").trim();
      if (!lineMessageId) continue;

      const profile = await getLineProfile(userId);
      const originalName =
        typeof profile?.displayName === "string" && profile.displayName.trim()
          ? profile.displayName.trim()
          : userId;
      const avatar = typeof profile?.pictureUrl === "string" ? profile.pictureUrl : "";

      let ingestPayload: Record<string, unknown> | null = null;
      let shouldRunAutomation = false;

      if (lineType === "text") {
        const japanese = String(event.message?.text || "").trim();
        if (!japanese) continue;

        ingestPayload = {
          customerId: userId,
          originalName,
          noteName: "",
          avatar,
          type: "TEXT",
          japanese,
          lineMessageId,
          skipTranslate: true,
        };
        shouldRunAutomation = true;
      } else if (lineType === "image") {
        try {
          const content = await getLineMessageContent(lineMessageId);
          const imageUrl = await uploadInboundImageToBlob({
            customerId: userId,
            lineMessageId,
            contentType: content.contentType,
            buffer: content.buffer,
          });

          ingestPayload = {
            customerId: userId,
            originalName,
            noteName: "",
            avatar,
            type: imageUrl ? "IMAGE" : "TEXT",
            japanese: imageUrl ? "" : "[图片]",
            imageUrl: imageUrl || "",
            lineMessageId,
            skipTranslate: true,
          };
        } catch (error) {
          console.error("LINE image content fetch/upload error:", error);
          ingestPayload = {
            customerId: userId,
            originalName,
            noteName: "",
            avatar,
            type: "TEXT",
            japanese: "[图片]",
            lineMessageId,
            skipTranslate: true,
          };
        }
      } else if (lineType === "sticker") {
        ingestPayload = {
          customerId: userId,
          originalName,
          noteName: "",
          avatar,
          type: "TEXT",
          japanese: "[贴图]",
          lineMessageId,
          skipTranslate: true,
        };
      }

      if (!ingestPayload) continue;

      let ingestJson: any = null;

      try {
        const ingestResponse = await fetch(`${internalBaseUrl}/api/ingest-customer-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ingestPayload),
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

      if (shouldRunAutomation) {
        after(async () => {
          await runInboundAutomation({
            customerId,
            targetMessageId: messageId,
            internalBaseUrl,
          });
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/line/webhook error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
