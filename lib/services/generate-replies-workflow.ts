import { prisma } from "@/lib/prisma";
import { publishRealtimeRefresh } from "@/lib/ably";
import { buildAnalysisContext, buildGenerationContext } from "@/lib/ai/context-builder";
import { runAnalysisRouter } from "@/lib/ai/analysis-router-service";
import { runReplyGeneration } from "@/lib/ai/reply-generation-service";
import { applyAnalysisStateToCustomer } from "@/lib/ai/state-merge-service";
import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";
import { saveDraftBundle } from "@/lib/ai/draft-metadata-service";
import { shouldReuseExistingDraft } from "@/lib/ai/workflow-policy";
import { getActiveAiStrategyVersion } from "@/lib/ai/strategy";
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
        tags: { include: { tag: true } },
        messages: { orderBy: { sentAt: "desc" }, take: 40 },
        replyDraftSets: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    })) as any,
  updateMessageChineseText: async (messageId, chineseText) => {
    await prisma.message.update({
      where: { id: messageId },
      data: { chineseText },
    });
  },
  publishRealtimeRefresh,
  buildAnalysisContext: (input) => buildAnalysisContext(input as any) as any,
  buildGenerationContext: (input) => buildGenerationContext(input as any) as any,
  runAnalysisRouter: (context) => runAnalysisRouter(context as any) as any,
  runReplyGeneration: (context) => runReplyGeneration(context as any) as any,
  applyAnalysisStateToCustomer: (input) => applyAnalysisStateToCustomer(input as any),
  translateCustomerJapaneseMessage,
  saveDraftBundle: (input) => saveDraftBundle(input as any),
  shouldReuseExistingDraft,
  getActiveAiStrategyVersion,
};

export async function generateRepliesWorkflow(input: GenerateRepliesWorkflowInput) {
  return executeGenerateRepliesWorkflow(input, runtimeDeps);
}
