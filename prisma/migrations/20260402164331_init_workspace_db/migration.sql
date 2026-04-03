-- CreateEnum
CREATE TYPE "CustomerStage" AS ENUM ('NEW', 'FIRST_CONTACT', 'FOLLOWING_UP', 'INTERESTED', 'NEGOTIATING', 'WAITING_PAYMENT', 'PAID', 'AFTER_SALES', 'LOST');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('CUSTOMER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('LINE', 'MANUAL', 'AI_SUGGESTION');

-- CreateEnum
CREATE TYPE "SuggestionVariant" AS ENUM ('STABLE', 'ADVANCING');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT,
    "remarkName" TEXT,
    "originalName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "stage" "CustomerStage" NOT NULL DEFAULT 'NEW',
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "aiCustomerInfo" TEXT,
    "aiCurrentStrategy" TEXT,
    "aiLastAnalyzedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundMessageAt" TIMESTAMP(3),
    "lastOutboundMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTag" (
    "customerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTag_pkey" PRIMARY KEY ("customerId","tagId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "source" "MessageSource" NOT NULL,
    "lineMessageId" TEXT,
    "japaneseText" TEXT NOT NULL,
    "chineseText" TEXT,
    "imageUrl" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyDraftSet" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "extraRequirement" TEXT,
    "stableJapanese" TEXT NOT NULL,
    "stableChinese" TEXT NOT NULL,
    "advancingJapanese" TEXT NOT NULL,
    "advancingChinese" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "selectedVariant" "SuggestionVariant",
    "selectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyDraftSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_lineUserId_key" ON "Customer"("lineUserId");

-- CreateIndex
CREATE INDEX "Customer_stage_idx" ON "Customer"("stage");

-- CreateIndex
CREATE INDEX "Customer_isVip_idx" ON "Customer"("isVip");

-- CreateIndex
CREATE INDEX "Customer_lastMessageAt_idx" ON "Customer"("lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Customer_originalName_idx" ON "Customer"("originalName");

-- CreateIndex
CREATE INDEX "Customer_remarkName_idx" ON "Customer"("remarkName");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Tag_sortOrder_idx" ON "Tag"("sortOrder");

-- CreateIndex
CREATE INDEX "CustomerTag_tagId_idx" ON "CustomerTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_lineMessageId_key" ON "Message"("lineMessageId");

-- CreateIndex
CREATE INDEX "Message_customerId_sentAt_idx" ON "Message"("customerId", "sentAt" ASC);

-- CreateIndex
CREATE INDEX "Message_customerId_role_sentAt_idx" ON "Message"("customerId", "role", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "ReplyDraftSet_customerId_createdAt_idx" ON "ReplyDraftSet"("customerId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "CustomerTag" ADD CONSTRAINT "CustomerTag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTag" ADD CONSTRAINT "CustomerTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraftSet" ADD CONSTRAINT "ReplyDraftSet_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
