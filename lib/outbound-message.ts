import { publishRealtimeRefresh } from "@/lib/ably";
import { buildLineMessages, pushLineMessages } from "@/lib/line-messaging";
import { prisma } from "@/lib/prisma";
import { MessageRole, MessageSendStatus, MessageSource, SuggestionVariant } from "@prisma/client";

type DispatchOutboundMessageOptions = {
  customerId: string;
  lineUserId: string;
  replyDraftSetId?: string | null;
  suggestionVariant?: SuggestionVariant | null;
  successReason?: string;
  failureReason?: string;
  incrementRetryCount?: boolean;
};

export async function dispatchOutboundMessageById(
  messageId: string,
  options: DispatchOutboundMessageOptions
) {
  const attemptAt = new Date();

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        customerId: true,
        role: true,
        type: true,
        source: true,
        japaneseText: true,
        imageUrl: true,
      },
    });

    if (!message || message.role !== MessageRole.OPERATOR) {
      throw new Error("消息不存在");
    }

    await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: MessageSendStatus.PENDING,
        sendError: null,
        failedAt: null,
        lastAttemptAt: attemptAt,
      },
    });

    const lineMessages = buildLineMessages({
      type: message.type,
      japaneseText: message.japaneseText,
      imageUrl: message.imageUrl,
    });

    await pushLineMessages(options.lineUserId, lineMessages, { retryKey: message.id });

    const sentMessage = await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: MessageSendStatus.SENT,
        sendError: null,
        failedAt: null,
        lastAttemptAt: attemptAt,
        ...(options.incrementRetryCount ? { retryCount: { increment: 1 } } : {}),
      },
    });

    if (
      message.source === MessageSource.AI_SUGGESTION &&
      options.replyDraftSetId &&
      options.suggestionVariant
    ) {
      await prisma.replyDraftSet.updateMany({
        where: {
          id: options.replyDraftSetId,
          customerId: options.customerId,
        },
        data: {
          selectedVariant: options.suggestionVariant,
          selectedAt: attemptAt,
        },
      });
    }

    try {
      await publishRealtimeRefresh({
        customerId: options.customerId,
        reason: options.successReason || "outbound-message-sent",
      });
    } catch (error) {
      console.error("Ably publish outbound-message-sent error:", error);
    }

    return { ok: true, message: sentMessage };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedAt = new Date();

    const failedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        deliveryStatus: MessageSendStatus.FAILED,
        sendError: errorMessage,
        failedAt,
        lastAttemptAt: failedAt,
        ...(options.incrementRetryCount ? { retryCount: { increment: 1 } } : {}),
      },
    });

    try {
      await publishRealtimeRefresh({
        customerId: options.customerId,
        reason: options.failureReason || "outbound-message-failed",
      });
    } catch (ablyError) {
      console.error("Ably publish outbound-message-failed error:", ablyError);
    }

    return { ok: false, error: errorMessage, message: failedMessage };
  }
}
