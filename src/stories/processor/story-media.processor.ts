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
import { StoryGateway } from 'src/realtime/gateways/story.gateway';
import { StoryMediaJobData } from './story-media-job.type';


@Processor('process-story-media')
export class StoryMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryMediaProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storyGateway: StoryGateway,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {
    super();
  }

  async process(job: Job<StoryMediaJobData>) {
    console.log({ job });

    if (job.name !== 'process-story-media') {
      return;
    }

    const { mediaId, storyId, userId, localPath, mimeType } = job.data;

    try {
      await this.db.storyMedia.update({
        where: {
          id: mediaId,
        },
        data: {
          status: 'PROCESSING',
        },
      });

      let processedPath = localPath;
      let thumbnailPath: string | undefined;

      let resourceType: 'image' | 'video' = 'image';

      if (mimeType.startsWith('video')) {
        resourceType = 'video';

        processedPath = path.join('./uploads/processed', `${mediaId}.mp4`);

        await compressVideo(localPath, processedPath);

        thumbnailPath = await generateThumbnail(
          processedPath,
          `${mediaId}.jpg`,
        );
      } else {
        const processed = await processImage(localPath, `${mediaId}.jpg`);

        processedPath = processed.outputPath;
      }

      const uploaded = await this.storage.uploadFile(processedPath, {
        userId,
        resourceType,
        customPublicId: `story_${storyId}_${mediaId}`,
      });

      let thumbnailUrl: string | undefined;

      if (thumbnailPath) {
        const thumbnailUpload = await this.storage.uploadFile(thumbnailPath, {
          userId,
          resourceType: 'image',
          isThumbnail: true,
          customPublicId: `story_${storyId}_${mediaId}_thumb`,
        });

        thumbnailUrl = thumbnailUpload.url;
      }

      await this.db.storyMedia.update({
        where: {
          id: mediaId,
        },
        data: {
          url: uploaded.url,
          publicId: uploaded.publicId,
          thumbnailUrl,
          width: uploaded.width,
          height: uploaded.height,
          status: 'READY',
        },
      });

      const pending = await this.db.storyMedia.count({
        where: {
          storyId,
          status: {
            in: ['PENDING', 'PROCESSING'],
          },
        },
      });

      if (pending === 0) {
        const story = await this.db.story.findUnique({
          where: {
            id: storyId,
          },
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
              orderBy: {
                order: 'asc',
              },
            },
          },
        });

        this.storyGateway.emitStoryReady(userId, {
          storyId,
          story,
        });
      }

      await this.cleanup(localPath);

      if (processedPath !== localPath) {
        await this.cleanup(processedPath);
      }

      if (thumbnailPath) {
        await this.cleanup(thumbnailPath);
      }
    } catch (error) {
      this.logger.error(error);

      await this.db.storyMedia.update({
        where: {
          id: mediaId,
        },
        data: {
          status: 'FAILED',
        },
      });

      this.storyGateway.emitStoryFailed(userId, {
        storyId,
        mediaId,
      });
    }
  }

  private async cleanup(file?: string) {
    if (!file) return;

    try {
      await fs.unlink(file);
    } catch {}
  }
}
