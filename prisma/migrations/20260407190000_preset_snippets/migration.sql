-- CreateTable
CREATE TABLE "PresetSnippet" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PresetSnippet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PresetSnippet_sortOrder_idx" ON "PresetSnippet"("sortOrder");

-- CreateIndex
CREATE INDEX "PresetSnippet_updatedAt_idx" ON "PresetSnippet"("updatedAt" DESC);
