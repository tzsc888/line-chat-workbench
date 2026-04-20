import { MessageRole, MessageSource, MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function isFirstInboundTextMessage(input: {
  customerId: string;
  messageId: string;
  sentAt: Date;
}) {
  const previousCount = await prisma.message.count({
    where: {
      customerId: input.customerId,
      role: MessageRole.CUSTOMER,
      source: MessageSource.LINE,
      type: MessageType.TEXT,
      id: { not: input.messageId },
      sentAt: { lte: input.sentAt },
    },
  });

  return previousCount === 0;
}

