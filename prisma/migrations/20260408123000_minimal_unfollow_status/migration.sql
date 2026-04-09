DO $$
BEGIN
  CREATE TYPE "LineRelationshipStatus" AS ENUM ('ACTIVE', 'UNFOLLOWED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "lineRelationshipStatus" "LineRelationshipStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "lineRelationshipUpdatedAt" TIMESTAMP(3);

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "lineRefollowedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Customer_lineRelationshipStatus_idx"
  ON "Customer"("lineRelationshipStatus");
