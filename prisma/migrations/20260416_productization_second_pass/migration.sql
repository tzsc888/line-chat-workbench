ALTER TYPE "FollowupState" ADD VALUE IF NOT EXISTS 'OBSERVING';
ALTER TYPE "FollowupState" ADD VALUE IF NOT EXISTS 'WAITING_WINDOW';
ALTER TYPE "FollowupState" ADD VALUE IF NOT EXISTS 'POST_PURCHASE_CARE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FollowupTimingBucket') THEN
    CREATE TYPE "FollowupTimingBucket" AS ENUM ('IMMEDIATE', 'TODAY', 'IN_1_DAY', 'IN_3_DAYS', 'IN_7_DAYS', 'NO_SET');
  END IF;
END $$;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "nextFollowupBucket" "FollowupTimingBucket",
  ADD COLUMN IF NOT EXISTS "riskTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ReplyDraftSet"
  ADD COLUMN IF NOT EXISTS "translationPromptVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "analysisPromptVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "generationPromptVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewPromptVersion" TEXT;

CREATE INDEX IF NOT EXISTS "Customer_nextFollowupBucket_idx" ON "Customer"("nextFollowupBucket");
