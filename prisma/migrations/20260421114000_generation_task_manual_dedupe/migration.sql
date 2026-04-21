ALTER TABLE "GenerationTask"
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE INDEX IF NOT EXISTS "GenerationTask_dedupeKey_idx"
  ON "GenerationTask"("dedupeKey");

CREATE UNIQUE INDEX IF NOT EXISTS "GenerationTask_manual_dedupe_active_key"
  ON "GenerationTask"("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL
    AND "triggerSource" = 'MANUAL_GENERATE'
    AND "status" IN ('PENDING', 'RUNNING');
