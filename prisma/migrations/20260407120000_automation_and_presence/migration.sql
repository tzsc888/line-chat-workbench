-- CreateEnum
CREATE TYPE "AutomationJobKind" AS ENUM ('INBOUND_WORKFLOW');

-- CreateEnum
CREATE TYPE "AutomationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "ReplyDraftSet" ADD COLUMN "targetCustomerMessageId" TEXT;

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "targetMessageId" TEXT NOT NULL,
    "kind" "AutomationJobKind" NOT NULL,
    "status" "AutomationJobStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorPresence" (
    "id" TEXT NOT NULL,
    "selectedCustomerId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplyDraftSet_customerId_targetCustomerMessageId_idx" ON "ReplyDraftSet"("customerId", "targetCustomerMessageId");

-- CreateIndex
CREATE INDEX "AutomationJob_status_scheduledFor_idx" ON "AutomationJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AutomationJob_customerId_updatedAt_idx" ON "AutomationJob"("customerId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationJob_customerId_targetMessageId_kind_key" ON "AutomationJob"("customerId", "targetMessageId", "kind");

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
