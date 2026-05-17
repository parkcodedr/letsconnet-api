
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import { ReactionType } from 'src/posts/types';

@Injectable()
export class PostReactionsService {
  private readonly CACHE_TTL = 300; 
  private readonly BATCH_CACHE_TTL = 60; 

  constructor(
    private db: DatabaseService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async reactToPost(userId: string, postId: string, type: ReactionType | null) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.postReaction.findUnique({
        where: { userId_postId: { userId, postId } },
      });

    
      if (!type || (existing && existing.type === type)) {
        if (existing) {
          await tx.postReaction.delete({ where: { id: existing.id } });
          await tx.post.update({
            where: { id: postId },
            data: { reactionsCount: { decrement: 1 } },
          });
        }
        
        await this.invalidatePostReactionCaches(postId, userId);
        
        return { reacted: false, type: null };
      }

      if (existing) {
        await tx.postReaction.update({
          where: { id: existing.id },
          data: { type },
        });
        
        await this.invalidatePostReactionCaches(postId, userId);
        
        return { reacted: true, type };
      }

      await tx.postReaction.create({
        data: { userId, postId, type },
      });
      await tx.post.update({
        where: { id: postId },
        data: { reactionsCount: { increment: 1 } },
      });
      
      await this.invalidatePostReactionCaches(postId, userId);
      
      return { reacted: true, type };
    });
  }

  
  async getPostReactionSummary(postId: string, userId: string) {
    const cacheKey = `reaction:summary:${postId}:${userId}`;
    
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const [counts, userReaction] = await Promise.all([
      this.db.postReaction.groupBy({
        by: ['type'],
        where: { postId },
        _count: { type: true },
      }),
      this.db.postReaction.findUnique({
        where: { userId_postId: { userId, postId } },
        select: { type: true },
      }),
    ]);

    const total = counts.reduce((sum, c) => sum + c._count.type, 0);
    const reactions = counts.map(c => ({ type: c.type, count: c._count.type }));
    
  
    reactions.sort((a, b) => b.count - a.count);

    const result = {
      total,
      reactions,
      userReaction: userReaction?.type || null,
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    
    return result;
  }

  
  async getBatchPostsReactions(postIds: string[], userId: string) {
    if (!postIds.length) return {};

    const cacheKey = `reaction:batch:${userId}:${postIds.sort().join(',')}`;
    
   
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

   
    const reactions = await this.db.postReaction.findMany({
      where: {
        postId: { in: postIds },
      },
      select: {
        postId: true,
        type: true,
        userId: true,
        createdAt: true,
      },
    });

   
    const userReactions = await this.db.postReaction.findMany({
      where: {
        postId: { in: postIds },
        userId: userId,
      },
      select: {
        postId: true,
        type: true,
      },
    });

   
    const reactionMap = new Map();
  
    postIds.forEach(postId => {
      reactionMap.set(postId, {
        total: 0,
        summary: {} as Record<ReactionType, number>,
        topReaction: null as ReactionType | null,
        userReaction: null as ReactionType | null,
      });
    });

   
    reactions.forEach(reaction => {
      const postData = reactionMap.get(reaction.postId);
      if (postData) {
        postData.total++;
        postData.summary[reaction.type] = (postData.summary[reaction.type] || 0) + 1;
      }
    });

    
    userReactions.forEach(reaction => {
      const postData = reactionMap.get(reaction.postId);
      if (postData) {
        postData.userReaction = reaction.type;
      }
    });

   
    for (const [postId, data] of reactionMap.entries()) {
      const reactionsArray = Object.entries(data.summary).map(([type, count]) => ({
        type: type as ReactionType,
        count: count as number,
      }));
      
      reactionsArray.sort((a, b) => b.count - a.count);
      
      data.topReaction = reactionsArray[0]?.type || null;
      data.reactions = reactionsArray; 
      
    }

    const result = Object.fromEntries(reactionMap);

    await this.redis.setex(cacheKey, this.BATCH_CACHE_TTL, JSON.stringify(result));
    
    return result;
  }


  async getReactionUsers(
    postId: string,
    userId: string,
    type?: ReactionType,
    page: number = 1,
    limit: number = 20,
  ) {
  
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const skip = (page - 1) * limit;
    const where = { postId, ...(type && { type }) };

    const [reactions, total] = await Promise.all([
      this.db.postReaction.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              profile: {
                select: {
                  firstName: true,
                  lastName: true,
                  username: true,
                  avatarUrl: true,
                  bio: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.postReaction.count({ where }),
    ]);

    return {
      data: reactions.map(reaction => ({
        user: reaction.user,
        reactionType: reaction.type,
        reactedAt: reaction.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        currentFilter: type || 'all',
      },
    };
  }

  private async invalidatePostReactionCaches(postId: string, userId: string) {
  
    await this.redis.del(`reaction:summary:${postId}:${userId}`);
    const keys = await this.redis.keys(`reaction:batch:${userId}:*`);
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  async getUserReactionHistory(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [reactions, total] = await Promise.all([
      this.db.postReaction.findMany({
        where: { userId },
        include: {
          post: {
            select: {
              id: true,
              content: true,
              createdAt: true,
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
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.postReaction.count({ where: { userId } }),
    ]);

    return {
      data: reactions.map(reaction => ({
        post: reaction.post,
        reactionType: reaction.type,
        reactedAt: reaction.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}