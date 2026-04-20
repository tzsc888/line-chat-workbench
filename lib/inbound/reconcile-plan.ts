import { AutomationJobKind } from "@prisma/client";

type ReconcileMessageInput = {
  id: string;
  customerId: string;
  chineseText: string | null;
};

type ReconcileJobInput = {
  customerId: string;
  targetMessageId: string;
  kind: AutomationJobKind;
};

export function planPartialInboundJobReconcile(input: {
  messages: ReconcileMessageInput[];
  jobs: ReconcileJobInput[];
}) {
  const jobSet = new Set(input.jobs.map((job) => `${job.customerId}:${job.targetMessageId}:${job.kind}`));
  const touchedMessageSet = new Set(input.jobs.map((job) => `${job.customerId}:${job.targetMessageId}`));
  const actions: Array<{
    customerId: string;
    targetMessageId: string;
    kind: AutomationJobKind;
  }> = [];

  for (const message of input.messages) {
    const messageKey = `${message.customerId}:${message.id}`;
    if (!touchedMessageSet.has(messageKey)) continue;

    const translationKey = `${message.customerId}:${message.id}:${AutomationJobKind.INBOUND_TRANSLATION}`;
    if (!jobSet.has(translationKey) && !message.chineseText?.trim()) {
      actions.push({
        customerId: message.customerId,
        targetMessageId: message.id,
        kind: AutomationJobKind.INBOUND_TRANSLATION,
      });
    }

  }

  return actions;
}
