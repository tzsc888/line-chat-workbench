-- CreateTable
CREATE TABLE "LineWebhookEventReceipt" (
    "webhookEventId" TEXT NOT NULL,
    "lineUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "isRedelivery" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineWebhookEventReceipt_pkey" PRIMARY KEY ("webhookEventId")
);

-- CreateIndex
CREATE INDEX "LineWebhookEventReceipt_lineUserId_createdAt_idx" ON "LineWebhookEventReceipt"("lineUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LineWebhookEventReceipt_eventType_createdAt_idx" ON "LineWebhookEventReceipt"("eventType", "createdAt" DESC);
