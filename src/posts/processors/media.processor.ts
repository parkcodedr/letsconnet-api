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
import { uploadWithRetry } from 'src/common/storage/upload-with-retry';

@Processor('media-processing', {
  concurrency: 2,
  lockDuration: 7200000,
  stalledInterval: 60000,
  maxStalledCount: 3,
})
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  private readonly UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
  private readonly PROCESSED_DIR = path.join(
    process.cwd(),
    'uploads',
    'processed',
  );
  private readonly RAW_DIR = path.join(process.cwd(), 'uploads', 'raw');

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

   
      await fs.mkdir(this.PROCESSED_DIR, { recursive: true });

      const localStats = await fs.stat(localPath).catch(() => null);
      if (!localStats || localStats.size === 0) {
        throw new Error(`Local file missing: ${localPath}`);
      }

      this.logger.log(`Processing ${mediaId}: size = ${localStats.size} bytes`);

      const finalPostId = postId || media.postId;
      const finalUserId = userId || media.post?.authorId;

      await this.db.media.update({
        where: { id: mediaId },
        data: { status: 'PROCESSING' },
      });

      let processedPath = localPath;
      let thumbnailPath: string | undefined;
      let resourceType: 'image' | 'video' = 'image';

      // =========================
      // VIDEO PIPELINE (FIXED)
      // =========================
      if (mimeType.startsWith('video')) {
        resourceType = 'video';

        processedPath = path.join(this.PROCESSED_DIR, `${mediaId}.mp4`);

        const durationSec = await this.getVideoDurationSafe(localPath);
        const timeout = Math.max(durationSec * 1000 * 4, 300000);

        await compressVideo(localPath, processedPath, timeout);

        const processedStats = await fs.stat(processedPath).catch(() => null);

        if (!processedStats || processedStats.size === 0) {
          throw new Error(`Video output invalid: ${processedPath}`);
        }

        this.logger.log(`Compressed ${mediaId}: ${processedStats.size} bytes`);

        thumbnailPath = await generateThumbnail(
          processedPath,
          `${mediaId}.jpg`,
        );
      }

   
      else if (mimeType.startsWith('image')) {
        resourceType = 'image';

        const processed = await processImage(localPath, `${mediaId}.jpg`);

        processedPath = processed.outputPath;
      }

    
      const uploaded = await uploadWithRetry(this.storage, processedPath, {
        postId: finalPostId,
        userId: finalUserId,
        resourceType,
        customPublicId: `${finalPostId}_${mediaId}_${Date.now()}`,
      });

      this.logger.log(`Upload confirmed for ${mediaId}: ${uploaded.url}`);

      let thumbnailUrl: string | undefined;

      if (thumbnailPath) {
        const thumb = await uploadWithRetry(this.storage, thumbnailPath, {
          postId: finalPostId,
          userId: finalUserId,
          resourceType: 'image',
          isThumbnail: true,
          customPublicId: `${finalPostId}_${mediaId}_thumb`,
        });

        thumbnailUrl = thumb.url;
      }

  
      await this.db.media.update({
        where: { id: mediaId },
        data: {
          url: uploaded.url,
          publicId: uploaded.publicId,
          thumbnailUrl,
          status: 'READY',
        },
      });

      await this.checkPostCompletion(finalPostId, finalUserId);

      
      await this.cleanupFile(localPath);

      if (processedPath !== localPath) {
        await this.cleanupFile(processedPath);
      }

      if (thumbnailPath) {
        await this.cleanupFile(thumbnailPath);
      }

      this.logger.log(`Media processed: ${mediaId} for post ${finalPostId}`);
    } catch (error: any) {
      this.logger.error(
        `Error processing media ${mediaId}: ${error.message}`,
        error.stack,
      );

      await this.db.media
        .update({
          where: { id: mediaId },
          data: { status: 'FAILED' },
        })
        .catch(() => null);

      throw error;
    }
  }

  
  private async cleanupFile(filePath?: string) {
    if (!filePath) return;

    try {
      await fs.unlink(filePath);
      this.logger.log(`Deleted temp file: ${filePath}`);
    } catch {
      this.logger.debug(`Could not delete: ${filePath}`);
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
      this.db.media.count({
        where: { postId, status: 'READY' },
      }),
      this.db.media.count({ where: { postId } }),
    ]);

    const allFailed = readyCount === 0 && totalCount > 0;
    const newStatus = allFailed ? 'FAILED' : 'READY';

    this.logger.log(
      `Post ${postId}: ${readyCount}/${totalCount} → ${newStatus}`,
    );

    await this.db.post.update({
      where: { id: postId },
      data: { status: newStatus },
    });

    const completedPost = await this.db.post.findUnique({
      where: { id: postId },
      include: {
        author: true,
        media: {
          where: { status: 'READY' },
        },
        _count: {
          select: {
            media: true,
            comments: true,
            reactions: true,
          },
        },
      },
    });

    await this.eventBus.publish(
      newStatus === 'READY' ? MediaEvents.POST_READY : MediaEvents.POST_ERROR,
      {
        userId,
        postId,
        post: completedPost,
        status: newStatus,
      },
    );
  }

  
  private async getVideoDurationSafe(filePath: string): Promise<number> {
    try {
      const { getVideoDuration } = await import('src/media/video-duration');
      return await getVideoDuration(filePath);
    } catch {
      return 30; 
    }
  }
}
