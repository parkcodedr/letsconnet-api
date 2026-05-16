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
    const { mediaId, localPath, mimeType, postId } = job.data;

    try {
      await this.db.media.update({
        where: {
          id: mediaId,
        },

        data: {
          status: 'PROCESSING',
        },
      });

      let processedPath = localPath;

      let thumbnailPath: string | undefined;

      if (mimeType.startsWith('video')) {
        processedPath = path.join('./uploads/processed', `${mediaId}.mp4`);

        await compressVideo(localPath, processedPath);

        thumbnailPath = await generateThumbnail(
          processedPath,
          `${mediaId}.jpg`,
        );
      } else if (mimeType.startsWith('image')) {
        const processed = await processImage(localPath, `${mediaId}.jpg`);

        processedPath = processed.outputPath;
      }

      const uploaded = await this.storage.uploadFile(processedPath);

      let thumbnailUrl: string | undefined;

      if (thumbnailPath) {
        const thumbnailUpload = await this.storage.uploadFile(thumbnailPath);

        thumbnailUrl = thumbnailUpload.url;
      }

      await this.db.media.update({
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

      this.mediaGateway.emitMediaReady(postId, {
        mediaId,
        status: 'READY',
      });

      await this.cleanupFile(localPath);

      if (processedPath !== localPath) {
        await this.cleanupFile(processedPath);
      }

      if (thumbnailPath) {
        await this.cleanupFile(thumbnailPath);
      }

      this.logger.log(`Media processed: ${mediaId}`);
    } catch (error) {
      this.logger.error(error);

      await this.db.media.update({
        where: {
          id: mediaId,
        },

        data: {
          status: 'FAILED',
        },
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
    } catch {}
  }
}
