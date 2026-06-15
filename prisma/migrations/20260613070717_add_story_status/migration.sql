/*
  Warnings:

  - Added the required column `updatedAt` to the `Story` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "reactionsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repliesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "StoryStatus" NOT NULL DEFAULT 'PROCESSING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "viewsCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoryMedia" ADD COLUMN     "localPath" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "status" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "url" DROP NOT NULL;
