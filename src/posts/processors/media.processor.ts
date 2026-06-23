// media.processor.ts
import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';

import { DatabaseService } from 'src/database/database.service';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';
import { MediaJobData } from '../jobs/media-job.type';
import { compressVideo } from 'src/media/video.processor';
import { generateThumbnail } from 'src/media/thumbnail.processor';
import { processImage } from 'src/media/image.processor';
import { EventBusService } from 'src/events/event-bus.service';
import { MediaEvents } from 'src/realtime/constant/socket-events';
import { getVideoDuration } from 'src/media/video-duration';
import { uploadWithRetry } from 'src/common/storage/upload-with-retry';

@Processor('media-processing', {
  concurrency: 2, 
  lockDuration: 7200000,
  stalledInterval: 60000,
  maxStalledCount: 3,
})
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {
    super();
  }

  async process(job: Job<MediaJobData>) {
    const { mediaId, localPath, mimeType, postId, userId } = job.data;

    try {
      const media = await this.db.media.findUnique({
        where: { id: mediaId },
        include: { post: true },
      });

      if (!media) {
        throw new Error(`Media not found: ${mediaId}`);
      }

      // Verify the local file actually exists and has content before doing anything
      const localStats = await fs.stat(localPath).catch(() => null);
      if (!localStats || localStats.size === 0) {
        throw new Error(
          `Local file missing or empty before processing: ${localPath}`,
        );
      }
      this.logger.log(
        `Processing ${mediaId}: local file size = ${localStats.size} bytes`,
      );

      const finalPostId = postId || media.postId;
      const finalUserId = userId || media.post?.authorId;

      await this.db.media.update({
        where: { id: mediaId },
        data: { status: 'PROCESSING' },
      });

      let processedPath = localPath;
      let thumbnailPath: string | undefined;
      let resourceType: 'image' | 'video' = 'image';

      if (mimeType.startsWith('video')) {
        resourceType = 'video';
        processedPath = path.join('./uploads/processed', `${mediaId}.mp4`);

        const durationSec = await getVideoDuration(localPath);
        const dynamicTimeout = Math.max(durationSec * 1000 * 4, 300000);

        await compressVideo(localPath, processedPath, dynamicTimeout);

        // Verify compression actually produced a valid output file
        const processedStats = await fs.stat(processedPath).catch(() => null);
        if (!processedStats || processedStats.size === 0) {
          throw new Error(
            `Compression produced empty/missing output: ${processedPath}`,
          );
        }
        this.logger.log(
          `Compressed ${mediaId}: output size = ${processedStats.size} bytes`,
        );

        thumbnailPath = await generateThumbnail(
          processedPath,
          `${mediaId}.jpg`,
        );
      } else if (mimeType.startsWith('image')) {
        resourceType = 'image';
        const processed = await processImage(localPath, `${mediaId}.jpg`);
        processedPath = processed.outputPath;
      }

      // Upload with retry — catches transient network/timeout failures
      const uploaded = await uploadWithRetry(this.storage, processedPath, {
        postId: finalPostId,
        userId: finalUserId,
        resourceType,
        customPublicId: `${finalPostId}_${mediaId}_${Date.now()}`,
      });

      this.logger.log(`Upload confirmed for ${mediaId}: ${uploaded.url}`);

      let thumbnailUrl: string | undefined;

      if (thumbnailPath) {
        const thumbnailUpload = await uploadWithRetry(
          this.storage,
          thumbnailPath,
          {
            postId: finalPostId,
            userId: finalUserId,
            resourceType: 'image',
            isThumbnail: true,
            customPublicId: `${finalPostId}_${mediaId}_thumbnail`,
          },
        );
        thumbnailUrl = thumbnailUpload.url;
      }

      await this.db.media.update({
        where: { id: mediaId },
        data: {
          url: uploaded.url,
          publicId: uploaded.publicId,
          thumbnailUrl,
          width: uploaded.width,
          height: uploaded.height,
          status: 'READY',
        },
      });

      await this.checkPostCompletion(finalPostId, finalUserId);

      await this.cleanupFile(localPath);
      if (processedPath !== localPath) await this.cleanupFile(processedPath);
      if (thumbnailPath) await this.cleanupFile(thumbnailPath);

      this.logger.log(`Media processed: ${mediaId} for post ${finalPostId}`);
    } catch (error: any) {
      // Full error surface — never let this disappear silently
      this.logger.error(
        `Error processing media ${mediaId}: ${error.message}`,
        error.stack,
      );

      let media;
      try {
        media = await this.db.media.findUnique({
          where: { id: mediaId },
          include: { post: true },
        });
      } catch (lookupError) {
        this.logger.error(
          `Failed to look up media ${mediaId} after error:`,
          lookupError,
        );
      }

      const finalPostId = postId || media?.postId;
      const finalUserId = userId || media?.post?.authorId;

      await this.db.media
        .update({
          where: { id: mediaId },
          data: {
            status: 'FAILED',
          },
        })
        .catch((updateError) => {
          this.logger.error(
            `Failed to mark media ${mediaId} as FAILED:`,
            updateError,
          );
        });

      if (finalPostId) {
        await this.checkPostCompletion(finalPostId, finalUserId).catch(
          (completionError) => {
            this.logger.error(
              `Failed to check post completion for ${finalPostId}:`,
              completionError,
            );
          },
        );
      } else {
        this.logger.error(
          `Cannot determine postId for failed media ${mediaId} — post status not updated`,
        );
      }

      // Re-throw so BullMQ's attempts/backoff actually kicks in
      throw error;
    }
  }

  private async cleanupFile(filePath?: string) {
    if (!filePath) return;

    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      this.logger.log(`Deleted temp file: ${filePath}`);
    } catch (error) {
      this.logger.debug(`Could not delete temp file: ${filePath}`);
    }
  }

  private async checkPostCompletion(postId: string, userId?: string) {
    const stillPending = await this.db.media.count({
      where: {
        postId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    if (stillPending > 0) return;

    const [readyCount, totalCount] = await Promise.all([
      this.db.media.count({ where: { postId, status: 'READY' } }),
      this.db.media.count({ where: { postId } }),
    ]);

    const allFailed = readyCount === 0 && totalCount > 0;
    const newStatus = allFailed ? 'FAILED' : 'READY';

    this.logger.log(
      `Post ${postId} completion check: ${readyCount}/${totalCount} ready → status=${newStatus}`,
    );

    await this.db.post.update({
      where: { id: postId },
      data: { status: newStatus },
    });

    if (newStatus === 'READY') {
      const completedPost = await this.db.post.findUnique({
        where: { id: postId },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              profile: {
                select: {
                  firstName: true,
                  lastName: true,
                  username: true,
                  avatarUrl: true,
                },
              },
            },
          },
          media: {
            where: { status: 'READY', url: { not: null } },
            orderBy: { order: 'asc' },
          },
          reactions: { where: { userId }, take: 1 },
          _count: {
            select: {
              media: { where: { status: 'READY' } },
              reactions: true,
              comments: true,
            },
          },
        },
      });

      await this.eventBus.publish(MediaEvents.POST_READY, {
        userId,
        postId,
        post: completedPost,
        status: 'READY',
        partialFailure: readyCount < totalCount,
      });
    } else {
      await this.eventBus.publish(MediaEvents.POST_ERROR, {
        userId,
        postId,
        status: 'FAILED',
      });
    }
  }
}
