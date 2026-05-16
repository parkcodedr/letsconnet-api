import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

import { Queue } from 'bullmq';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class PostsService {
  constructor(
    private readonly db: DatabaseService,

    @InjectQueue('media-processing')
    private readonly mediaQueue: Queue,
  ) {}

  async createPost(
    userId: string,
    content?: string,
    files?: Express.Multer.File[],
  ) {
    const post = await this.db.post.create({
      data: {
        authorId: userId,
        content,
        status: 'PROCESSING',
      },
    });

    if (files?.length) {
      for (const [index, file] of files.entries()) {
        console.log({ file });

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
          post,
        });
      }
    } else {
      await this.db.post.update({
        where: { id: post.id },
        data: {
          status: 'READY',
        },
      });
    }

    return {
      postId: post.id,
      status: 'PROCESSING',
    };
  }

  private getMediaType(file: Express.Multer.File) {
    if (file.mimetype.startsWith('image')) return 'IMAGE';
    if (file.mimetype.startsWith('video')) return 'VIDEO';

    return 'AUDIO';
  }
}
