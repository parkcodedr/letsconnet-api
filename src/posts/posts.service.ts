import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from 'src/database/database.service';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';
import Redis from 'ioredis';
import * as fs from 'fs/promises';
import { PostWithRelations } from './types';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';

@Injectable()
export class PostsService {
  private readonly CACHE_TTL = 300;

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue('media-processing')
    private readonly mediaQueue: Queue,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async getUserPosts(userId: string, page: number = 1, limit: number = 10) {
    const cacheKey = `user_posts:${userId}:${page}:${limit}`;

    const cachedData = await this.redis.get(cacheKey);
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.db.post.findMany({
        where: {
          authorId: userId,
          status: { not: 'FAILED' },
        },
        include: {
          media: {
            where: {
              status: 'READY',
              url: { not: null },
            },
            orderBy: {
              order: 'asc',
            },
            take: 1,
          },
          _count: {
            select: {
              media: {
                where: {
                  status: 'READY',
                },
              },
              reactions: true,
              comments: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.db.post.count({
        where: {
          authorId: userId,
          status: { not: 'FAILED' },
        },
      }),
    ]);

    const result = {
      data: posts.map((post) => ({
        id: post.id,
        content: post.content,
        status: post.status,
        visibility: post.visibility,
        thumbnailUrl: post.media[0]?.url || null,
        mediaCount: post._count.media,
        reactionsCount: post._count.reactions,
        commentsCount: post._count.comments,
        sharesCount: post.sharesCount,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  async getPostById(userId: string, postId: string) {
    const cacheKey = `post:${postId}:${userId}`;

    const cachedPost = await this.redis.get(cacheKey);
    if (cachedPost) {
      const parsed = JSON.parse(cachedPost);
      if (parsed === null) return null;
      return parsed;
    }

    const post: PostWithRelations | null = await this.db.post.findFirst({
      where: {
        id: postId,
        status: { not: 'FAILED' },
      },
      include: {
        media: {
          where: {
            status: 'READY',
            url: { not: null },
          },
          orderBy: {
            order: 'asc',
          },
        },
        author: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                avatarUrl: true,
                username: true,
              },
            },
          },
        },
        reactions: {
          where: {
            userId: userId,
          },
          select: {
            type: true,
          },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    });

    if (!post) {
      await this.redis.setex(cacheKey, 60, JSON.stringify(null));
      return null;
    }

    const allReactions = await this.db.postReaction.groupBy({
      by: ['type'],
      where: {
        postId: postId,
      },
      _count: {
        type: true,
      },
    });

    const reactionCounts = allReactions.reduce(
      (acc, reaction) => {
        acc[reaction.type] = reaction._count.type;
        return acc;
      },
      {} as Record<string, number>,
    );

    const result = {
      id: post.id,
      content: post.content,
      status: post.status,
      visibility: post.visibility,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: post.author,
      media: post.media,
      reactionCounts,
      currentUserReaction: post.reactions[0]?.type || null,
      commentsCount: post._count.comments,
      sharesCount: post.sharesCount,
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  private async invalidateUserPostsCache(userId: string): Promise<void> {
    const pattern = `user_posts:${userId}:*`;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  private async invalidatePostCache(postId: string): Promise<void> {
    const pattern = `post:${postId}:*`;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  async deletePost(userId: string, postId: string) {
    const post = await this.db.post.findFirst({
      where: {
        id: postId,
        authorId: userId,
      },
      include: {
        media: {
          where: {
            publicId: { not: null },
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.media.length > 0) {
      try {
        await this.storage.deletePostMedia(postId, userId);
      } catch (error) {
        console.error('Error deleting media from Cloudinary:', error);
      }
    }

    await this.db.post.delete({
      where: { id: postId },
    });

    for (const media of post.media) {
      const jobs = await this.mediaQueue.getJobs(['waiting', 'active']);
      for (const job of jobs) {
        if (job.data.mediaId === media.id) {
          await job.remove();
        }
      }
    }

    for (const media of post.media) {
      if (media.localPath) {
        await this.cleanupFile(media.localPath).catch(() => {});
      }
    }

    await this.invalidatePostCache(postId);
    await this.invalidateUserPostsCache(userId);

    return {
      success: true,
      message: 'Post deleted successfully',
    };
  }

  async createPost(
    userId: string,
    content?: string,
    files?: Express.Multer.File[],
  ) {
    const post = await this.db.post.create({
      data: {
        authorId: userId,
        content: content || null,
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

    await this.invalidateUserPostsCache(userId);

    return {
      id: post.id,
      status: post.status,
      message: files?.length
        ? 'Post created, media processing in background'
        : 'Post created successfully',
    };
  }

  private getMediaType(file: Express.Multer.File): 'IMAGE' | 'VIDEO' | 'AUDIO' {
    if (file.mimetype.startsWith('image')) return 'IMAGE';
    if (file.mimetype.startsWith('video')) return 'VIDEO';
    if (file.mimetype.startsWith('audio')) return 'AUDIO';
    return 'IMAGE';
  }

  private async cleanupFile(filePath?: string) {
    if (!filePath) return;
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
    } catch {}
  }
}
