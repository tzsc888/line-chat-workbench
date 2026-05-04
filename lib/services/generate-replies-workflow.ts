import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { buildMainBrainGenerationContext } from "@/lib/ai/context-builder";
import { runReplyGeneration } from "@/lib/ai/reply-generation-service";
import { translateCustomerJapaneseMessage, translateGeneratedReply } from "@/lib/ai/translation-service";
import { saveDraftBundle } from "@/lib/ai/draft-metadata-service";
import { shouldReuseExistingDraft } from "@/lib/ai/workflow-policy";
import {
  executeGenerateRepliesWorkflow,
  type GenerateRepliesWorkflowInput,
  type GenerateRepliesWorkflowDeps,
} from "@/lib/services/generate-replies-workflow-core";

export type GenerateRepliesTriggerSource = "AUTO_FIRST_INBOUND" | "MANUAL_GENERATE";

const runtimeDeps: GenerateRepliesWorkflowDeps = {
  findCustomerById: async (customerId) =>
    (await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        messages: { orderBy: [{ sentAt: "asc" }, { id: "asc" }] },
        replyDraftSets: { orderBy: { createdAt: "desc" }, take: 1 },
        tags: { include: { tag: true } },
      },
    })) as NonNullable<Awaited<ReturnType<GenerateRepliesWorkflowDeps["findCustomerById"]>>>,
  updateMessageChineseText: async (messageId, chineseText) => {
    await prisma.message.updateMany({
      where: {
        id: messageId,
        chineseText: null,
      },
      data: { chineseText },
    });
  },
  getMessageChineseText: async (messageId) => {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { chineseText: true },
    });
    return message?.chineseText || null;
  },
  publishRealtimeRefresh,
  buildMainBrainGenerationContext: (input) =>
    buildMainBrainGenerationContext(input as Parameters<typeof buildMainBrainGenerationContext>[0]),
  runReplyGeneration: (context) => runReplyGeneration(context),
  translateCustomerJapaneseMessage,
  translateGeneratedReply,
  saveDraftBundle: (input) => saveDraftBundle(input as Parameters<typeof saveDraftBundle>[0]),
  shouldReuseExistingDraft,
};

export async function generateRepliesWorkflow(input: GenerateRepliesWorkflowInput) {
  return executeGenerateRepliesWorkflow(input, runtimeDeps);
}

