/*
  Warnings:

  - You are about to drop the column `mediaUrl` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `thumbnailUrl` on the `Message` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Message_senderId_createdAt_idx";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "mediaUrl",
DROP COLUMN "thumbnailUrl",
ADD COLUMN     "deletedFor" TEXT[],
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "isForwarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replyToId" TEXT;

-- CreateTable
CREATE TABLE "MessageMedia" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "size" INTEGER,
    "publicId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageMedia_messageId_idx" ON "MessageMedia"("messageId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- AddForeignKey
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
