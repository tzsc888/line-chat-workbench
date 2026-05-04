import { prisma } from "@/lib/prisma";

export async function staleOpenDraftsForCustomer(params: {
  customerId: string;
  reason: string;
}) {
  const { customerId, reason } = params;
  await prisma.replyDraftSet.updateMany({
    where: {
      customerId,
      selectedVariant: null,
      isStale: false,
    },
    data: {
      isStale: true,
      staleReason: reason,
      staleAt: new Date(),
    },
  });
}

export async function saveDraftBundle(params: {
  customerId: string;
  targetCustomerMessageId: string | null;
  extraRequirement?: string | null;
  modelName: string;
  translationPromptVersion?: string | null;
  generationPromptVersion?: string | null;
  generation: {
    reply_ja: string;
  };
  replyTranslation: {
    reply_zh: string;
  };
}) {
  const {
    customerId,
    targetCustomerMessageId,
    extraRequirement,
    modelName,
    translationPromptVersion,
    generationPromptVersion,
    generation,
    replyTranslation,
  } = params;

  await staleOpenDraftsForCustomer({
    customerId,
    reason: "new-generation-generated",
  });

  return prisma.replyDraftSet.create({
    data: {
      customerId,
      targetCustomerMessageId,
      extraRequirement: extraRequirement || null,
      stableJapanese: generation.reply_ja,
      stableChinese: replyTranslation.reply_zh || "",
      advancingJapanese: generation.reply_ja,
      advancingChinese: replyTranslation.reply_zh || "",
      modelName,
      translationPromptVersion: translationPromptVersion || null,
      generationPromptVersion: generationPromptVersion || null,
    },
  });
}

