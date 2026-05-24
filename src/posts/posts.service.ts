import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from 'src/database/database.service';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';
import { StorageProvider } from 'src/common/storage/storage.interface';
import Redis from 'ioredis';
import * as fs from 'fs/promises';
import { OriginalPostWithRelations, PostWithRelations } from './types';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import { PostResourceMapper } from './resources/post.resource';
import { ShareResourceMapper } from './resources/share.resource';

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
          status: 'READY',
        },
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
          reactions: {
            where: { userId },
            take: 1,
          },
          _count: {
            select: {
              media: { where: { status: 'READY' } },
              reactions: true,
              comments: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.post.count({
        where: { authorId: userId, status: 'READY' },
      }),
    ]);

    const sharedPostIds = posts
      .map((p) => p.sharedPostId)
      .filter((id): id is string => id !== null);

    const uniqueSharedPostIds = [...new Set(sharedPostIds)];

    let originalPostsMap = new Map();

    if (uniqueSharedPostIds.length > 0) {
      const originalPosts = await this.db.post.findMany({
        where: { id: { in: uniqueSharedPostIds } },
        include: {
          author: {
            select: {
              id: true,
              email: true, // Add email if needed
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
            where: { status: 'READY' },
            orderBy: { order: 'asc' },
          },
          _count: {
            select: { reactions: true, comments: true },
          },
        },
      });

      originalPosts.forEach((op) => originalPostsMap.set(op.id, op));
    }

    const mappedPosts = posts.map((post) => {
      const originalPost = post.sharedPostId
        ? originalPostsMap.get(post.sharedPostId)
        : null;
      return PostResourceMapper.toPostResource(post, userId, originalPost);
    });

    const result = {
      data: mappedPosts,
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

    const post = await this.db.post.findFirst({
      where: { id: postId, status: { not: 'FAILED' } },
      include: {
        media: {
          where: { status: 'READY', url: { not: null } },
          orderBy: { order: 'asc' },
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
          where: { userId },
          select: { type: true },
        },
        _count: {
          select: { comments: true, reactions: true },
        },
      },
    });

    if (!post) {
      await this.redis.setex(cacheKey, 60, JSON.stringify(null));
      return null;
    }

    let originalPost: OriginalPostWithRelations | null = null;

    if (post.sharedPostId) {
      const fetchedOriginal = await this.db.post.findUnique({
        where: { id: post.sharedPostId },
        include: {
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
          media: {
            where: { status: 'READY', url: { not: null } },
            orderBy: { order: 'asc' },
          },
          _count: {
            select: { comments: true, reactions: true },
          },
        },
      });

      if (fetchedOriginal) {
        originalPost = fetchedOriginal as OriginalPostWithRelations;
      }
    }

    const allReactions = await this.db.postReaction.groupBy({
      by: ['type'],
      where: { postId },
      _count: { type: true },
    });

    const reactionCounts = allReactions.reduce(
      (acc, reaction) => {
        acc[reaction.type] = reaction._count.type;
        return acc;
      },
      {} as Record<string, number>,
    );

    const result = PostResourceMapper.toPostDetailResource(
      post as PostWithRelations,
      reactionCounts,
      userId,
      originalPost,
    );

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

  async sharePost(userId: string, postId: string, caption?: string) {
    const originalPost = await this.db.post.findFirst({
      where: { id: postId, status: { not: 'FAILED' } },
      include: {
        author: {
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
          where: { status: 'READY' },
          take: 1,
        },
      },
    });

    if (!originalPost) {
      throw new NotFoundException('Post not found');
    }

    const sharedPost = await this.db.$transaction(async (tx) => {
      const newPost = await tx.post.create({
        data: {
          authorId: userId,
          sharedPostId: postId,
          sharedCaption: caption || null,
          status: 'READY',
          visibility: 'PUBLIC',
        },
        include: {
          author: {
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
        },
      });

      await tx.post.update({
        where: { id: postId },
        data: { sharesCount: { increment: 1 } },
      });

      if (originalPost.authorId !== userId) {
        await tx.notification.create({
          data: {
            receiverId: originalPost.authorId,
            type: 'POST_SHARE',
            senderId: userId,
            postId: postId,
            metadata: {
              caption: caption?.substring(0, 100),
              sharedPostId: newPost.id,
            },
          },
        });
      }

      return newPost;
    });

    await this.invalidateUserPostsCache(userId);
    await this.invalidatePostCache(postId);

    return ShareResourceMapper.toShareResponse(sharedPost, originalPost);
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
