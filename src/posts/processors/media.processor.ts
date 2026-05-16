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
import { MediaGateway } from 'src/realtime/gateways/media.gateway';

@Processor('media-processing')
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mediaGateway: MediaGateway,

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

        await compressVideo(localPath, processedPath);

        thumbnailPath = await generateThumbnail(
          processedPath,
          `${mediaId}.jpg`,
        );
      } else if (mimeType.startsWith('image')) {
        resourceType = 'image';
        const processed = await processImage(localPath, `${mediaId}.jpg`);
        processedPath = processed.outputPath;
      }

      const uploaded = await this.storage.uploadFile(processedPath, {
        postId: finalPostId,
        userId: finalUserId,
        resourceType: resourceType,
        customPublicId: `${finalPostId}_${mediaId}_${Date.now()}`,
      });

      let thumbnailUrl: string | undefined;

      if (thumbnailPath) {
        const thumbnailUpload = await this.storage.uploadFile(thumbnailPath, {
          postId: finalPostId,
          userId: finalUserId,
          resourceType: 'image',
          isThumbnail: true,
          customPublicId: `${finalPostId}_${mediaId}_thumbnail`,
        });
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

      const pendingMedia = await this.db.media.count({
        where: {
          postId: finalPostId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
      });

      if (pendingMedia === 0) {
        await this.db.post.update({
          where: { id: finalPostId },
          data: { status: 'READY' },
        });
      }

      this.mediaGateway.emitMediaReady(finalPostId, {
        mediaId,
        status: 'READY',
        url: uploaded.url,
        thumbnailUrl,
      });

      await this.cleanupFile(localPath);
      if (processedPath !== localPath) {
        await this.cleanupFile(processedPath);
      }
      if (thumbnailPath) {
        await this.cleanupFile(thumbnailPath);
      }

      this.logger.log(`Media processed: ${mediaId} for post ${finalPostId}`);
    } catch (error) {
      this.logger.error(`Error processing media ${mediaId}:`, error);

      await this.db.media.update({
        where: { id: mediaId },
        data: { status: 'FAILED' },
      });

      this.mediaGateway.emitMediaError(postId, {
        mediaId,
        status: 'FAILED',
        error: 'Upload failed',
      });

      await this.cleanupFile(localPath).catch(() => {});
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
}
