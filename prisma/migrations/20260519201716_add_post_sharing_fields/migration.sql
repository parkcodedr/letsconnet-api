-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "sharedCaption" TEXT,
ADD COLUMN     "sharedPostId" TEXT;

-- CreateIndex
CREATE INDEX "Post_sharedPostId_idx" ON "Post"("sharedPostId");
