-- DropIndex
DROP INDEX "Friendship_receiverId_idx";

-- AlterTable
ALTER TABLE "Friendship" ADD COLUMN     "actionUserId" TEXT,
ADD COLUMN     "requestCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "respondedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FriendSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suggestedUserId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "isViewed" BOOLEAN NOT NULL DEFAULT false,
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FriendSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendRequestRateLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FriendRequestRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FriendSuggestion_userId_isViewed_isDismissed_idx" ON "FriendSuggestion"("userId", "isViewed", "isDismissed");

-- CreateIndex
CREATE INDEX "FriendSuggestion_expiresAt_idx" ON "FriendSuggestion"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FriendSuggestion_userId_suggestedUserId_key" ON "FriendSuggestion"("userId", "suggestedUserId");

-- CreateIndex
CREATE INDEX "FriendRequestRateLimit_date_idx" ON "FriendRequestRateLimit"("date");

-- CreateIndex
CREATE UNIQUE INDEX "FriendRequestRateLimit_userId_date_key" ON "FriendRequestRateLimit"("userId", "date");

-- CreateIndex
CREATE INDEX "Friendship_receiverId_status_idx" ON "Friendship"("receiverId", "status");

-- CreateIndex
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

-- CreateIndex
CREATE INDEX "Friendship_status_createdAt_idx" ON "Friendship"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Friendship_receiverId_createdAt_idx" ON "Friendship"("receiverId", "createdAt");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_actionUserId_fkey" FOREIGN KEY ("actionUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendSuggestion" ADD CONSTRAINT "FriendSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendSuggestion" ADD CONSTRAINT "FriendSuggestion_suggestedUserId_fkey" FOREIGN KEY ("suggestedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequestRateLimit" ADD CONSTRAINT "FriendRequestRateLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
