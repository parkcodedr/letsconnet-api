/*
  Warnings:

  - You are about to drop the column `commentsCount` on the `Media` table. All the data in the column will be lost.
  - You are about to drop the column `reactionsCount` on the `Media` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Media" DROP COLUMN "commentsCount",
DROP COLUMN "reactionsCount",
ADD COLUMN     "localPath" TEXT,
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "status" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "url" DROP NOT NULL;
