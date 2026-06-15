import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseService } from 'src/database/database.service';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';
import { compressVideo } from 'src/media/video.processor';
import { generateThumbnail } from 'src/media/thumbnail.processor';
import { processImage } from 'src/media/image.processor';
import { convertToMp3, getAudioDuration } from 'src/media/audio.processor';
import { MediaGateway } from 'src/realtime/gateways/media.gateway';

export interface ChatMediaJobData {
  messageMediaId: string;
  localPath: string;
  mimeType: string;
  messageId: string;
  chatId: string;
  userId: string;
  order: number;
}

@Processor('chat-media-processing')
export class ChatMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(ChatMediaProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly mediaGateway: MediaGateway,
  ) {
    super();
  }

  async process(job: Job<ChatMediaJobData>) {
    const {
      messageMediaId,
      localPath,
      mimeType,
      messageId,
      chatId,
      userId,
      order,
    } = job.data;

    try {
      const media = await this.db.messageMedia.findUnique({
        where: { id: messageMediaId },
      });
      if (!media) throw new Error(`Media not found: ${messageMediaId}`);

      let processedPath = localPath;
      let thumbnailPath: string | undefined;
      let resourceType: 'image' | 'video' | 'audio' = 'image';
      let duration: number | undefined;
      let finalMimeType = mimeType;

      // Video
      if (mimeType.startsWith('video')) {
        resourceType = 'video';
        processedPath = path.join(
          './uploads/chat_processed',
          `${messageMediaId}.mp4`,
        );
        await compressVideo(localPath, processedPath);
        thumbnailPath = await generateThumbnail(
          processedPath,
          `${messageMediaId}.jpg`,
        );
        duration = await this.getDuration(processedPath);
      }
      // Image
      else if (mimeType.startsWith('image')) {
        resourceType = 'image';
        const processed = await processImage(
          localPath,
          `${messageMediaId}.jpg`,
        );
        processedPath = processed.outputPath;
      } else if (mimeType.startsWith('audio')) {
        resourceType = 'audio';
        const outputMp3 = path.join(
          './uploads/chat_processed',
          `${messageMediaId}.mp3`,
        );
        await convertToMp3(localPath, outputMp3);
        processedPath = outputMp3;
        finalMimeType = 'audio/mpeg';
        duration = await getAudioDuration(processedPath);
      }

      const folder = `letsconnet/chats/${chatId}/messages/${messageId}`;
      const uploaded = await this.storage.uploadFile(processedPath, {
        userId,
        resourceType,
        customPublicId: `${messageMediaId}_${Date.now()}`,
      });

      let thumbnailUrl: string | undefined;
      if (thumbnailPath) {
        const thumbUpload = await this.storage.uploadFile(thumbnailPath, {
          userId,
          resourceType: 'image',
          isThumbnail: true,
          customPublicId: `${messageMediaId}_thumb`,
        });
        thumbnailUrl = thumbUpload.url;
      }

      await this.db.messageMedia.update({
        where: { id: messageMediaId },
        data: {
          url: uploaded.url,
          thumbnailUrl,
          width: uploaded.width,
          height: uploaded.height,
          duration,
          size: uploaded.bytes,
          publicId: uploaded.publicId,
        },
      });

      // this.mediaGateway.emitChatMediaReady(chatId, {
      //   messageId,
      //   mediaId: messageMediaId,
      //   url: uploaded.url,
      //   thumbnailUrl,
      // });

      await this.cleanupFile(localPath);
      if (processedPath !== localPath) await this.cleanupFile(processedPath);
      if (thumbnailPath) await this.cleanupFile(thumbnailPath);

      this.logger.log(
        `Chat media processed: ${messageMediaId} for message ${messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing chat media ${messageMediaId}:`,
        error,
      );
      await this.cleanupFile(localPath).catch(() => {});
      // this.mediaGateway.emitChatMediaError(chatId, {
      //   messageId,
      //   mediaId: messageMediaId,
      //   error: error instanceof Error ? error.message : 'Unknown error',
      // });
    }
  }

  private async getDuration(filePath: string): Promise<number> {
    // Use ffprobe via a helper – simplified, you can implement using fluent-ffmpeg
    return 0;
  }

  private async cleanupFile(filePath?: string) {
    if (!filePath) return;
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
    } catch {}
  }
}
