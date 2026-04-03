import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MessageRole, MessageSource, MessageType } from "@prisma/client";

async function callModel(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  temperature = 0.2
) {
  const response = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${text}`);
  }

  return JSON.parse(text);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const helperModel = process.env.HELPER_MODEL;

  try {
    const body = await req.json();

    const lineUserId = String(body.customerId || "").trim();
    const originalName = String(body.originalName || "").trim();
    const remarkName = String(body.noteName || "").trim();
    const avatar = String(body.avatar || "").trim();
    const japanese = String(body.japanese || "").trim();
    const lineMessageId = String(body.lineMessageId || "").trim();
    const skipTranslate = body.skipTranslate === true;

    if (!lineUserId || !japanese) {
      return NextResponse.json(
        { ok: false, error: "缺少 customerId 或 japanese" },
        { status: 400 }
      );
    }

    const now = new Date();

    const customer = await prisma.customer.upsert({
      where: {
        lineUserId,
      },
      update: {
        originalName: originalName || undefined,
        remarkName: remarkName || undefined,
        avatarUrl: avatar.startsWith("http") ? avatar : undefined,
        lastMessageAt: now,
        lastInboundMessageAt: now,
      },
      create: {
        lineUserId,
        originalName: originalName || lineUserId,
        remarkName: remarkName || null,
        avatarUrl: avatar.startsWith("http") ? avatar : null,
        lastMessageAt: now,
        lastInboundMessageAt: now,
      },
    });

    if (lineMessageId) {
      const existingMessage = await prisma.message.findUnique({
        where: { lineMessageId },
      });

      if (existingMessage) {
        return NextResponse.json({
          ok: true,
          line: "重复消息，已跳过重复入库",
          model: helperModel || "",
          translated: !!existingMessage.chineseText,
          translateError: "",
          customer: {
            id: customer.id,
            lineUserId: customer.lineUserId,
            originalName: customer.originalName,
            remarkName: customer.remarkName,
            avatarUrl: customer.avatarUrl,
          },
          message: existingMessage,
        });
      }
    }

    // 第一步：先保存消息，保证消息立刻可见
    const message = await prisma.message.create({
      data: {
        customerId: customer.id,
        role: MessageRole.CUSTOMER,
        type: MessageType.TEXT,
        source: MessageSource.LINE,
        lineMessageId: lineMessageId || null,
        japaneseText: japanese,
        chineseText: null,
        sentAt: now,
      },
    });

    // 如果要求跳过翻译，这里直接返回，让外层先推送页面
    if (skipTranslate) {
      return NextResponse.json({
        ok: true,
        line: "已快速入库，跳过同步翻译",
        model: helperModel || "",
        translated: false,
        translateError: "",
        customer: {
          id: customer.id,
          lineUserId: customer.lineUserId,
          originalName: customer.originalName,
          remarkName: customer.remarkName,
          avatarUrl: customer.avatarUrl,
        },
        message,
      });
    }

    // 第二步：非快模式下，继续同步翻译
    let chinese = "";
    let translated = false;
    let line = "";
    let translateError = "";

    const canTranslate =
      !!apiKey && !!baseUrl && !!backupBaseUrl && !!helperModel;

    if (canTranslate) {
      const systemPrompt =
        "你是一个日语到中文的翻译助手，只输出中文翻译结果。";

      const userPrompt = `请把下面这句日语自然地翻译成简洁准确的中文。
要求：
1. 只输出中文
2. 不要解释
3. 不要加引号
4. 保留语气和情绪

日语：
${japanese}`;

      try {
        let data;
        line = "主线路成功";

        try {
          data = await callModel(
            baseUrl!,
            apiKey!,
            helperModel!,
            systemPrompt,
            userPrompt,
            0.2
          );
        } catch {
          data = await callModel(
            backupBaseUrl!,
            apiKey!,
            helperModel!,
            systemPrompt,
            userPrompt,
            0.2
          );
          line = "主线路失败，已切到备用线路成功";
        }

        chinese = data?.choices?.[0]?.message?.content?.trim() || "";

        if (chinese) {
          await prisma.message.update({
            where: { id: message.id },
            data: {
              chineseText: chinese,
            },
          });
          translated = true;
        }
      } catch (error) {
        translateError = String(error);
        console.error("POST /api/ingest-customer-message translate error:", error);
      }
    } else {
      translateError = "AI 翻译环境变量缺失，已跳过翻译";
    }

    return NextResponse.json({
      ok: true,
      line: line || "未调用翻译线路",
      model: helperModel || "",
      translated,
      translateError,
      customer: {
        id: customer.id,
        lineUserId: customer.lineUserId,
        originalName: customer.originalName,
        remarkName: customer.remarkName,
        avatarUrl: customer.avatarUrl,
      },
      message: {
        ...message,
        chineseText: translated ? chinese : null,
      },
    });
  } catch (error) {
    console.error("POST /api/ingest-customer-message error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}