-- AlterTable
ALTER TABLE "MediaComment" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "reactionsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repliesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MediaCommentReaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "type" "ReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaCommentReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaCommentReaction_commentId_idx" ON "MediaCommentReaction"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaCommentReaction_userId_commentId_key" ON "MediaCommentReaction"("userId", "commentId");

-- CreateIndex
CREATE INDEX "MediaComment_parentId_idx" ON "MediaComment"("parentId");

-- AddForeignKey
ALTER TABLE "MediaComment" ADD CONSTRAINT "MediaComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCommentReaction" ADD CONSTRAINT "MediaCommentReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCommentReaction" ADD CONSTRAINT "MediaCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "MediaComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
