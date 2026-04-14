DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScheduledMessageStatus') THEN
    CREATE TYPE "ScheduledMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" "MessageType" NOT NULL DEFAULT 'TEXT',
  "source" "MessageSource" NOT NULL DEFAULT 'MANUAL',
  "japaneseText" TEXT NOT NULL,
  "chineseText" TEXT,
  "imageUrl" TEXT,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
  "replyDraftSetId" TEXT,
  "suggestionVariant" "SuggestionVariant",
  "deliveredMessageId" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "sendError" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledMessage_deliveredMessageId_key" ON "ScheduledMessage"("deliveredMessageId");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_status_scheduledFor_idx" ON "ScheduledMessage"("status", "scheduledFor" ASC);
CREATE INDEX IF NOT EXISTS "ScheduledMessage_customerId_scheduledFor_idx" ON "ScheduledMessage"("customerId", "scheduledFor" DESC);
CREATE INDEX IF NOT EXISTS "ScheduledMessage_customerId_status_scheduledFor_idx" ON "ScheduledMessage"("customerId", "status", "scheduledFor" ASC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ScheduledMessage_customerId_fkey'
  ) THEN
    ALTER TABLE "ScheduledMessage"
      ADD CONSTRAINT "ScheduledMessage_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
