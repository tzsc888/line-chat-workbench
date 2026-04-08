-- CreateEnum
CREATE TYPE "FollowupBucket" AS ENUM ('UNCONVERTED', 'VIP');

-- CreateEnum
CREATE TYPE "FollowupTier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "FollowupState" AS ENUM ('ACTIVE', 'DONE', 'PAUSED');

-- AlterTable
ALTER TABLE "Customer"
ADD COLUMN "followupBucket" "FollowupBucket",
ADD COLUMN "followupTier" "FollowupTier",
ADD COLUMN "followupState" "FollowupState" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "nextFollowupAt" TIMESTAMP(3),
ADD COLUMN "followupReason" TEXT,
ADD COLUMN "lastFollowupHandledAt" TIMESTAMP(3),
ADD COLUMN "followupUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Customer_followupBucket_followupTier_idx" ON "Customer"("followupBucket", "followupTier");

-- CreateIndex
CREATE INDEX "Customer_nextFollowupAt_idx" ON "Customer"("nextFollowupAt" ASC);
