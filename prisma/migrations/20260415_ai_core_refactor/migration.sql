ALTER TABLE "ReplyDraftSet"
ADD COLUMN     "sceneType" TEXT,
ADD COLUMN     "routeType" TEXT,
ADD COLUMN     "replyGoal" TEXT,
ADD COLUMN     "pushLevel" TEXT,
ADD COLUMN     "generationBriefJson" TEXT,
ADD COLUMN     "reviewFlagsJson" TEXT,
ADD COLUMN     "programChecksJson" TEXT,
ADD COLUMN     "aiReviewJson" TEXT,
ADD COLUMN     "finalGateJson" TEXT,
ADD COLUMN     "differenceNote" TEXT,
ADD COLUMN     "selfCheckJson" TEXT,
ADD COLUMN     "recommendedVariant" "SuggestionVariant",
ADD COLUMN     "isStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "staleReason" TEXT,
ADD COLUMN     "staleAt" TIMESTAMP(3);

CREATE INDEX "ReplyDraftSet_customerId_isStale_createdAt_idx" ON "ReplyDraftSet"("customerId", "isStale", "createdAt" DESC);
