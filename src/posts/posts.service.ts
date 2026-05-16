import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DatabaseService } from 'src/database/database.service';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';
import * as fs from 'fs/promises';

@Injectable()
export class PostsService {
  constructor(
    private readonly db: DatabaseService,

    @InjectQueue('media-processing')
    private readonly mediaQueue: Queue,

    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {}

  async createPost(
    userId: string,
    content?: string,
    files?: Express.Multer.File[],
  ) {
    const post = await this.db.post.create({
      data: {
        authorId: userId,
        content: content || '',
        status: files?.length ? 'PROCESSING' : 'READY',
      },
    });

    if (files?.length) {
      const mediaPromises = files.map(async (file, index) => {
        const media = await this.db.media.create({
          data: {
            postId: post.id,
            type: this.getMediaType(file),
            status: 'PENDING',
            localPath: file.path,
            order: index,
          },
        });

        await this.mediaQueue.add('process-media', {
          mediaId: media.id,
          localPath: file.path,
          mimeType: file.mimetype,
          postId: post.id,
          userId: userId,
        });

        return media;
      });

      await Promise.all(mediaPromises);
    }

    return {
      postId: post.id,
      status: files?.length ? 'PROCESSING' : 'READY',
    };
  }

  async getPost(postId: string, userId: string) {
    const post = await this.db.post.findFirst({
      where: {
        id: postId,
        authorId: userId,
      },
      include: {
        media: {
          orderBy: {
            order: 'asc',
          },
        },
      },
    });

    return post;
  }

  async deletePost(postId: string, userId: string) {
    await this.storage.deletePostMedia(postId, userId);
    const post = await this.db.post.delete({
      where: {
        id: postId,
        authorId: userId,
      },
    });

    return post;
  }

  private getMediaType(file: Express.Multer.File) {
    if (file.mimetype.startsWith('image')) return 'IMAGE';
    if (file.mimetype.startsWith('video')) return 'VIDEO';
    return 'AUDIO';
  }
}
