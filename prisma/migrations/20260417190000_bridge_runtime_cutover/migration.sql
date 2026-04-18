-- Add bridge-native customer identity and outbound task queue.
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "bridgeThreadId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_bridgeThreadId_key"
  ON "Customer"("bridgeThreadId");

CREATE INDEX IF NOT EXISTS "Customer_bridgeThreadId_idx"
  ON "Customer"("bridgeThreadId");

ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Message_fingerprint_key"
  ON "Message"("fingerprint");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutboundTaskStatus') THEN
    CREATE TYPE "OutboundTaskStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'CANCELED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OutboundTask" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "bridgeThreadId" TEXT NOT NULL,
  "status" "OutboundTaskStatus" NOT NULL DEFAULT 'PENDING',
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboundTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutboundTask_messageId_key"
  ON "OutboundTask"("messageId");

CREATE INDEX IF NOT EXISTS "OutboundTask_status_createdAt_idx"
  ON "OutboundTask"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "OutboundTask_bridgeThreadId_status_idx"
  ON "OutboundTask"("bridgeThreadId", "status");

CREATE INDEX IF NOT EXISTS "OutboundTask_nextRetryAt_idx"
  ON "OutboundTask"("nextRetryAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OutboundTask_customerId_fkey'
      AND table_name = 'OutboundTask'
  ) THEN
    ALTER TABLE "OutboundTask"
      ADD CONSTRAINT "OutboundTask_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OutboundTask_messageId_fkey'
      AND table_name = 'OutboundTask'
  ) THEN
    ALTER TABLE "OutboundTask"
      ADD CONSTRAINT "OutboundTask_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "Message"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
