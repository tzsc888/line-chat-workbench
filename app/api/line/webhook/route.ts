import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";

function verifyLineSignature(body: string, signature: string, secret: string) {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");

  return hash === signature;
}

async function getLineProfile(userId: string) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/profile/${userId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

async function shouldAnalyzeCustomer(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      aiCustomerInfo: true,
      aiCurrentStrategy: true,
      aiLastAnalyzedAt: true,
    },
  });

  if (!customer) return false;

  if (!customer.aiCustomerInfo || !customer.aiCurrentStrategy) {
    return true;
  }

  const newInboundCount = await prisma.message.count({
    where: {
      customerId,
      role: "CUSTOMER",
      ...(customer.aiLastAnalyzedAt
        ? {
            sentAt: {
              gt: customer.aiLastAnalyzedAt,
            },
          }
        : {}),
    },
  });

  return newInboundCount >= 3;
}

export async function POST(req: NextRequest) {
  try {
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!channelSecret) {
      return NextResponse.json(
        { ok: false, error: "缺少 LINE_CHANNEL_SECRET" },
        { status: 500 }
      );
    }

    const signature = req.headers.get("x-line-signature") || "";
    const bodyText = await req.text();

    if (!verifyLineSignature(bodyText, signature, channelSecret)) {
      return NextResponse.json(
        { ok: false, error: "LINE 签名校验失败" },
        { status: 401 }
      );
    }

    const body = JSON.parse(bodyText);
    const events = Array.isArray(body.events) ? body.events : [];
    const internalBaseUrl =
      process.env.INTERNAL_APP_BASE_URL || "http://127.0.0.1:3000";

    console.log("LINE webhook body:", JSON.stringify(body, null, 2));

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

      const avatar =
        typeof profile?.pictureUrl === "string" ? profile.pictureUrl : "";

      let ingestJson: any = null;

      // 第一步：只做快速入库，不等待翻译
      try {
        const ingestResponse = await fetch(
          `${internalBaseUrl}/api/ingest-customer-message`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              customerId: userId,
              originalName,
              noteName: "",
              avatar,
              japanese,
              lineMessageId,
              skipTranslate: true,
            }),
          }
        );

        ingestJson = await ingestResponse.json();
        console.log("LINE ingest result:", JSON.stringify(ingestJson));
      } catch (error) {
        console.error("LINE ingest fetch error:", error);
        continue;
      }

      if (!ingestJson?.ok || !ingestJson?.customer?.id || !ingestJson?.message?.id) {
        continue;
      }

      const customerId = String(ingestJson.customer.id);
      const messageId = String(ingestJson.message.id);

      // 第二步：消息先推到页面，原文立刻可见
      try {
        await publishRealtimeRefresh({
          customerId,
          reason: "inbound-message",
        });
      } catch (error) {
        console.error("Ably publish inbound-message error:", error);
      }

      // 第三步：把 AI 工作放到响应后执行，不阻塞消息显示
      after(async () => {
        // 1) 翻译后补
        try {
          const translateResponse = await fetch(
            `${internalBaseUrl}/api/translate-message`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                japanese,
              }),
            }
          );

          const translateJson = await translateResponse.json();
          console.log("LINE auto translate result:", JSON.stringify(translateJson));

          if (translateResponse.ok && translateJson?.ok && translateJson?.chinese) {
            await prisma.message.update({
              where: { id: messageId },
              data: {
                chineseText: translateJson.chinese,
              },
            });

            await publishRealtimeRefresh({
              customerId,
              reason: "translation-updated",
            });
          }
        } catch (error) {
          console.error("LINE auto translate error:", error);
        }

        // 2) 按条件整理客户信息
        try {
          const needAnalyze = await shouldAnalyzeCustomer(customerId);

          if (needAnalyze) {
            const analyzeResponse = await fetch(
              `${internalBaseUrl}/api/analyze-customer`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  customerId,
                }),
              }
            );

            const analyzeJson = await analyzeResponse.json();
            console.log("LINE auto analyze result:", JSON.stringify(analyzeJson));
          }
        } catch (error) {
          console.error("LINE auto analyze error:", error);
        }

        // 3) 自动生成建议回复
        try {
          const generateResponse = await fetch(
            `${internalBaseUrl}/api/generate-replies`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                customerId,
                rewriteInput: "",
              }),
            }
          );

          const generateJson = await generateResponse.json();
          console.log(
            "LINE auto generate result:",
            JSON.stringify(generateJson)
          );
        } catch (error) {
          console.error("LINE auto generate error:", error);
        }

        // 4) 整理/建议更新后，再推一次页面
        try {
          await publishRealtimeRefresh({
            customerId,
            reason: "assistant-updated",
          });
        } catch (error) {
          console.error("Ably publish assistant-updated error:", error);
        }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("LINE webhook error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}