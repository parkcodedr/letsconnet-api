import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import * as fs from 'fs/promises';
import * as path from 'path';

import { DatabaseService } from 'src/database/database.service';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';

import { compressVideo } from 'src/media/video.processor';
import { processImage } from 'src/media/image.processor';
import { generateThumbnail } from 'src/media/thumbnail.processor';

import { StoryMediaJobData } from './story-media-job.type';
import { EventBusService } from 'src/events/event-bus.service';
import { StoryEvents } from 'src/realtime/constant/socket-events';

import { uploadWithRetry } from 'src/common/storage/upload-with-retry';

@Processor('process-story-media', {
  concurrency: 2,
  lockDuration: 7200000,
  stalledInterval: 60000,
  maxStalledCount: 3,
})
export class StoryMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryMediaProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {
    super();
  }

  async process(job: Job<StoryMediaJobData>) {
    const { mediaId, storyId, userId, localPath, mimeType } = job.data;

    try {
      const media = await this.db.storyMedia.findUnique({
        where: { id: mediaId },
      });

      if (!media) {
        throw new Error(`Story media not found: ${mediaId}`);
      }

      const stats = await fs.stat(localPath).catch(() => null);
      if (!stats || stats.size === 0) {
        throw new Error(`Invalid local file: ${localPath}`);
      }

      this.logger.log(`Processing story media ${mediaId}: ${stats.size} bytes`);

      await this.db.storyMedia.update({
        where: { id: mediaId },
        data: { status: 'PROCESSING' },
      });

      let processedPath = localPath;
      let thumbnailPath: string | undefined;
      let resourceType: 'image' | 'video' = 'image';

      if (mimeType.startsWith('video')) {
        resourceType = 'video';

        processedPath = path.join(
          process.cwd(),
          'uploads',
          'processed',
          `${mediaId}.mp4`,
        );

        const timeout = Math.max(300000, stats.size / 1024 / 50);

        await compressVideo(localPath, processedPath, timeout);

        const processedStats = await fs.stat(processedPath).catch(() => null);
        if (!processedStats || processedStats.size === 0) {
          throw new Error(`Video compression failed: ${processedPath}`);
        }

        thumbnailPath = await generateThumbnail(
          processedPath,
          `${mediaId}.jpg`,
        );
      } else {
        const processed = await processImage(localPath, `${mediaId}.jpg`);
        processedPath = processed.outputPath;
      }

      const uploaded = await uploadWithRetry(this.storage, processedPath, {
        userId,
        resourceType,
        customPublicId: `story_${storyId}_${mediaId}_${Date.now()}`,
      });

      let thumbnailUrl: string | undefined;

      if (thumbnailPath) {
        const thumb = await uploadWithRetry(this.storage, thumbnailPath, {
          userId,
          resourceType: 'image',
          isThumbnail: true,
          customPublicId: `story_${storyId}_${mediaId}_thumb`,
        });

        thumbnailUrl = thumb.url;
      }

      await this.db.storyMedia.update({
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

      await this.checkStoryCompletion(storyId, userId);

      await this.cleanup(localPath);
      if (processedPath !== localPath) await this.cleanup(processedPath);
      if (thumbnailPath) await this.cleanup(thumbnailPath);

      this.logger.log(`Story media processed: ${mediaId}`);
    } catch (error: any) {
      this.logger.error(
        `Error processing story media ${mediaId}: ${error.message}`,
        error.stack,
      );

      await this.db.storyMedia
        .update({
          where: { id: mediaId },
          data: { status: 'FAILED' },
        })
        .catch(() => {});

      await this.eventBus.publish(StoryEvents.STORY_ERROR, {
        userId,
        storyId,
        mediaId,
        status: 'FAILED',
      });

      throw error;
    }
  }

  private async checkStoryCompletion(storyId: string, userId: string) {
    const pending = await this.db.storyMedia.count({
      where: {
        storyId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    if (pending > 0) return;

    const story = await this.db.story.findUnique({
      where: { id: storyId },
      include: {
        user: {
          select: {
            id: true,
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
          orderBy: { order: 'asc' },
        },
      },
    });

    await this.eventBus.publish(StoryEvents.STORY_READY, {
      userId,
      storyId,
      story,
      status: 'READY',
    });
  }

  private async cleanup(file?: string) {
    if (!file) return;

    try {
      await fs.access(file);
      await fs.unlink(file);
      this.logger.log(`Deleted temp file: ${file}`);
    } catch {
      this.logger.debug(`Cleanup skipped: ${file}`);
    }
  }
}
