import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import {
  queueInboundTranslation,
  runInboundAutomation,
  translateInboundMessageImmediately,
} from "@/lib/inbound-automation";
import { buildDefaultRemarkName } from "@/lib/customers/default-remark-name";
import { computeLineRefollowedAt } from "@/lib/customers/relationship-transition";
import { decideInboundTriggerPolicy } from "@/lib/inbound/trigger-policy";
import { isFirstInboundTextMessage } from "@/lib/inbound/first-inbound";
import { constantTimeEqual } from "@/lib/security/secret";
import { ingestCustomerMessage, type IngestCustomerMessageInput } from "@/lib/services/ingest-customer-message";
import { isLegacyEndpointEnabled, legacyEndpointDisabledResponse } from "@/lib/legacy-endpoint-toggle";

function verifyLineSignature(body: string, signature: string, secret: string) {
  const hash = crypto.createHmac("sha256", secret).update(body).digest("base64");
  return constantTimeEqual(hash, signature);
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
      cache: "no-store",
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
    cache: "no-store",
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
  const blob = await put(`line-inbound/${params.customerId}/${params.lineMessageId}.${ext}`, params.buffer, {
    access: "public",
    addRandomSuffix: false,
    contentType: params.contentType,
  });

  return blob.url;
}

async function markCustomerRelationshipStatus(
  lineUserId: string,
  status: "ACTIVE" | "UNFOLLOWED",
  options?: {
    originalName?: string;
    avatarUrl?: string;
  },
) {
  const now = new Date();

  const existing = await prisma.customer.findUnique({
    where: { lineUserId },
    select: { id: true, lineRelationshipStatus: true, lineRefollowedAt: true },
  });

  if (existing) {
    await prisma.customer.update({
      where: { id: existing.id },
      data: {
        lineRelationshipStatus: status,
        lineRelationshipUpdatedAt: now,
        lineRefollowedAt: computeLineRefollowedAt({
          previousStatus: existing.lineRelationshipStatus,
          nextStatus: status,
          previousLineRefollowedAt: existing.lineRefollowedAt,
          now,
          isCreate: false,
        }),
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
        remarkName: buildDefaultRemarkName(options?.originalName || "", lineUserId, now),
        avatarUrl: options?.avatarUrl || null,
        lineRelationshipStatus: "ACTIVE",
        lineRelationshipUpdatedAt: now,
        lineRefollowedAt: computeLineRefollowedAt({
          previousStatus: null,
          nextStatus: "ACTIVE",
          now,
          isCreate: true,
        }),
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

async function claimWebhookEvent(event: Record<string, unknown>) {
  const webhookEventId = typeof event.webhookEventId === "string" ? event.webhookEventId.trim() : "";
  if (!webhookEventId) return true;

  try {
    await prisma.lineWebhookEventReceipt.create({
      data: {
        webhookEventId,
        eventType: typeof event.type === "string" ? event.type : "unknown",
        lineUserId: typeof (event.source as { userId?: string } | undefined)?.userId === "string" ? (event.source as { userId?: string }).userId! : null,
        isRedelivery: Boolean((event.deliveryContext as { isRedelivery?: boolean } | undefined)?.isRedelivery),
        occurredAt: typeof event.timestamp === "number" ? new Date(event.timestamp) : null,
      },
    });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Legacy LINE webhook entry: disabled by default to avoid accidental external traffic costs.
    // To re-enable, set ENABLE_LEGACY_LINE_WEBHOOK=true.
    if (!isLegacyEndpointEnabled("ENABLE_LEGACY_LINE_WEBHOOK")) {
      return legacyEndpointDisabledResponse("line_webhook");
    }

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

    for (const event of events) {
      if (event.source?.type !== "user") continue;
      if (!(await claimWebhookEvent(event))) continue;

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
            typeof profile?.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : userId,
          avatarUrl: typeof profile?.pictureUrl === "string" ? profile.pictureUrl : "",
        });
        continue;
      }

      if (event.type !== "message") continue;

      const lineType = String(event.message?.type || "").trim();
      if (!["text", "image", "sticker"].includes(lineType)) continue;

      const lineMessageId = String(event.message?.id || "").trim();
      if (!lineMessageId) continue;

      const profile = await getLineProfile(userId);
      const originalName = typeof profile?.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : "";
      const avatar = typeof profile?.pictureUrl === "string" ? profile.pictureUrl : "";

      let ingestPayload: IngestCustomerMessageInput | null = null;
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

      let ingestResult: Awaited<ReturnType<typeof ingestCustomerMessage>> | null = null;
      try {
        ingestResult = await ingestCustomerMessage(ingestPayload);
      } catch (error) {
        console.error("LINE ingest error:", error);
        continue;
      }

      if (!ingestResult?.ok || !ingestResult.customer?.id || !ingestResult.message?.id) {
        continue;
      }

      const customerId = String(ingestResult.customer.id);
      const messageId = String(ingestResult.message.id);
      const triggerDecision = decideInboundTriggerPolicy({
        mode: "live",
        messageType: lineType === "image" ? "IMAGE" : lineType === "sticker" ? "STICKER" : "TEXT",
        created: !!ingestResult.created,
        isFirstInboundText:
          lineType === "text" &&
          !!ingestResult.created &&
          await isFirstInboundTextMessage({
            customerId,
            messageId,
            sentAt: ingestResult.message.sentAt,
          }),
      });

      if (ingestResult.created) {
        try {
          await publishRealtimeRefresh({
            customerId,
            reason: "inbound-message",
            messageId,
          });
        } catch (error) {
          console.error("Ably publish inbound-message error:", error);
        }
      }

      if (triggerDecision.shouldQueueTranslation) {
        const immediate = await translateInboundMessageImmediately({
          customerId,
          messageId,
          reason: "line-webhook",
        });
        if (!immediate.ok) {
          console.error("line webhook immediate translation failed:", {
            customerId,
            messageId,
            error: immediate.error,
          });
          await queueInboundTranslation({
            customerId,
            targetMessageId: messageId,
          });
        }
      }

      if (triggerDecision.shouldQueueWorkflow) {
        after(async () => {
          await runInboundAutomation({
            customerId,
            targetMessageId: messageId,
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
