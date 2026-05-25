-- AlterTable
ALTER TABLE "MessageMedia" ADD COLUMN     "localPath" TEXT,
ADD COLUMN     "status" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "url" DROP NOT NULL;
