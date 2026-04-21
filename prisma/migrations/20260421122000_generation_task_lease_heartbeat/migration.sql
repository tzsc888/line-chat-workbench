ALTER TABLE "GenerationTask"
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "GenerationTask_status_leaseExpiresAt_idx"
  ON "GenerationTask"("status", "leaseExpiresAt");
