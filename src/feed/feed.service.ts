import { Injectable, Inject } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { Redis as RedisClient } from 'ioredis';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import { GetFeedDto } from './dto/feed.dto';
import { PostResourceMapper } from 'src/posts/resources/post.resource';

@Injectable()
export class FeedService {
  private readonly FEED_CACHE_TTL = 60;
  private readonly CACHE_TTL = 300;

  constructor(
    private db: DatabaseService,
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisClient,
  ) {}

  async getUserFeed(userId: string, query: GetFeedDto) {
    const { page = 1, limit = 20, sortBy = 'recent' } = query;
    const cacheKey = `feed:${userId}:${page}:${limit}:${sortBy}`;

    const cachedData = await this.redis.get(cacheKey);
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const friendIds = await this.getFriendIds(userId);
    const userIds = [userId, ...friendIds];

    if (userIds.length === 0) {
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      };
    }

    const skip = (page - 1) * limit;
    const orderBy =
      sortBy === 'popular'
        ? { reactionsCount: 'desc' as const }
        : { createdAt: 'desc' as const };

    const [posts, total] = await Promise.all([
      this.db.post.findMany({
        where: {
          authorId: { in: userIds },
          status: 'READY',
          visibility: 'PUBLIC',
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
        orderBy,
        skip,
        take: limit,
      }),
      this.db.post.count({
        where: {
          authorId: { in: userIds },
          status: 'READY',
          visibility: 'PUBLIC',
        },
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

    await this.redis.setex(
      cacheKey,
      this.FEED_CACHE_TTL,
      JSON.stringify(result),
    );
    return result;
  }

  async getUserFeedCursor(userId: string, limit: number = 20, cursor?: string) {
    const friendIds = await this.getFriendIds(userId);
    const userIds = [userId, ...friendIds];

    let cursorCondition = {};
    if (cursor) {
      cursorCondition = {
        createdAt: { lt: new Date(cursor) },
      };
    }

    const posts = await this.db.post.findMany({
      where: {
        authorId: { in: userIds },
        status: 'READY',
        visibility: 'PUBLIC',
        ...cursorCondition,
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
      take: limit + 1,
    });

    // Batch fetch shared posts (exactly like getUserPosts)
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
          _count: {
            select: { reactions: true, comments: true },
          },
        },
      });

      originalPosts.forEach((op) => originalPostsMap.set(op.id, op));
    }

    const hasMore = posts.length > limit;
    const items = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

    // Use PostResourceMapper like in getUserPosts
    const mappedPosts = items.map((post) => {
      const originalPost = post.sharedPostId
        ? originalPostsMap.get(post.sharedPostId)
        : null;
      return PostResourceMapper.toPostResource(post, userId, originalPost);
    });

    return {
      data: mappedPosts,
      nextCursor: nextCursor?.toISOString(),
      hasMore,
    };
  }

  private async getFriendIds(userId: string): Promise<string[]> {
    const cacheKey = `user:friends:${userId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const friendships = await this.db.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      select: {
        requesterId: true,
        receiverId: true,
      },
    });

    const friendIds = friendships.map((f) =>
      f.requesterId === userId ? f.receiverId : f.requesterId,
    );

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(friendIds));
    return friendIds;
  }

  async invalidateUserFeed(userId: string) {
    const pattern = `feed:${userId}:*`;
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

  // Invalidate feed cache when user posts, shares, or friends change
  async invalidateFeedForUsers(userIds: string[]) {
    const promises = userIds.map((userId) => this.invalidateUserFeed(userId));
    await Promise.all(promises);
  }
}
