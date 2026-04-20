ALTER TYPE "AutomationJobKind" ADD VALUE IF NOT EXISTS 'INBOUND_TRANSLATION';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UiRefreshOutboxStatus') THEN
    CREATE TYPE "UiRefreshOutboxStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "UiRefreshOutbox" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "reason" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "payload" JSONB,
  "status" "UiRefreshOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextRetryAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UiRefreshOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UiRefreshOutbox_status_nextRetryAt_createdAt_idx"
  ON "UiRefreshOutbox"("status", "nextRetryAt", "createdAt" ASC);

CREATE INDEX IF NOT EXISTS "UiRefreshOutbox_customerId_createdAt_idx"
  ON "UiRefreshOutbox"("customerId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'UiRefreshOutbox_customerId_fkey'
      AND table_name = 'UiRefreshOutbox'
  ) THEN
    ALTER TABLE "UiRefreshOutbox"
      ADD CONSTRAINT "UiRefreshOutbox_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
