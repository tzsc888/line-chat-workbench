-- Create generation task queue model for async reply generation.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GenerationTaskStatus') THEN
    CREATE TYPE "GenerationTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GenerationTaskTriggerSource') THEN
    CREATE TYPE "GenerationTaskTriggerSource" AS ENUM ('MANUAL_GENERATE', 'AUTO_FIRST_INBOUND');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "GenerationTask" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "targetMessageId" TEXT,
  "rewriteInput" TEXT,
  "autoMode" BOOLEAN NOT NULL DEFAULT false,
  "triggerSource" "GenerationTaskTriggerSource" NOT NULL,
  "status" "GenerationTaskStatus" NOT NULL DEFAULT 'PENDING',
  "stage" TEXT NOT NULL DEFAULT 'queued',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "errorDetailsJson" TEXT,
  "resultDraftSetId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 2,
  "nextRetryAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GenerationTask_status_nextRetryAt_createdAt_idx"
  ON "GenerationTask"("status", "nextRetryAt", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationTask_customerId_createdAt_idx"
  ON "GenerationTask"("customerId", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationTask_targetMessageId_idx"
  ON "GenerationTask"("targetMessageId");

CREATE INDEX IF NOT EXISTS "GenerationTask_resultDraftSetId_idx"
  ON "GenerationTask"("resultDraftSetId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'GenerationTask_customerId_fkey'
      AND table_name = 'GenerationTask'
  ) THEN
    ALTER TABLE "GenerationTask"
      ADD CONSTRAINT "GenerationTask_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'GenerationTask_targetMessageId_fkey'
      AND table_name = 'GenerationTask'
  ) THEN
    ALTER TABLE "GenerationTask"
      ADD CONSTRAINT "GenerationTask_targetMessageId_fkey"
      FOREIGN KEY ("targetMessageId") REFERENCES "Message"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'GenerationTask_resultDraftSetId_fkey'
      AND table_name = 'GenerationTask'
  ) THEN
    ALTER TABLE "GenerationTask"
      ADD CONSTRAINT "GenerationTask_resultDraftSetId_fkey"
      FOREIGN KEY ("resultDraftSetId") REFERENCES "ReplyDraftSet"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
