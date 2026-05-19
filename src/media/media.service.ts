
import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import Redis from 'ioredis';
import { ReactionType } from 'src/posts/types';
import { CreateMediaCommentDto } from './dto/media-comment.dto';


@Injectable()
export class MediaService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly MEDIA_REACTIONS_PREFIX = 'media:reactions:';
  private readonly MEDIA_COMMENTS_PREFIX = 'media:comments:';
  private readonly MEDIA_CACHE_PREFIX = 'media:';

  constructor(
    private db: DatabaseService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

 

  async reactToMedia(
    userId: string,
    mediaId: string,
    type: ReactionType | null,
  ) {
   
    const media = await this.db.media.findUnique({
      where: { id: mediaId },
      include: {
        post: {
          select: {
            id: true,
            authorId: true,
          },
        },
      },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const result = await this.db.$transaction(async (tx) => {
      const existing = await tx.mediaReaction.findUnique({
        where: {
          userId_mediaId: {
            userId,
            mediaId,
          },
        },
      });

      
      if (!type || (existing && existing.type === type)) {
        if (existing) {
          await tx.mediaReaction.delete({ where: { id: existing.id } });
        }
        return { reacted: false, type: null };
      }

    
      if (existing) {
        await tx.mediaReaction.update({
          where: { id: existing.id },
          data: { type },
        });
        return { reacted: true, type };
      }

      
      await tx.mediaReaction.create({
        data: { userId, mediaId, type },
      });

      
      if (media.post.authorId !== userId) {
        await tx.notification.create({
          data: {
            receiverId: media.post.authorId,
            type: 'MEDIA_LIKE',
            senderId: userId,
            postId: media.post.id,
            metadata: {
              mediaId: mediaId,
              reactionType: type,
              mediaType: media.type,
            },
          },
        });
      }

      return { reacted: true, type };
    });

    
    await this.invalidateMediaReactionsCache(mediaId);

    return result;
  }

  async getMediaReactionSummary(mediaId: string, userId: string) {
    const cacheKey = `${this.MEDIA_REACTIONS_PREFIX}${mediaId}:${userId}`;
    
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const [reactionGroups, userReaction] = await Promise.all([
      this.db.mediaReaction.groupBy({
        by: ['type'],
        where: { mediaId },
        _count: { type: true },
      }),
      this.db.mediaReaction.findUnique({
        where: {
          userId_mediaId: {
            userId,
            mediaId,
          },
        },
        select: { type: true },
      }),
    ]);

    const total = reactionGroups.reduce((sum, group) => sum + group._count.type, 0);
    const reactions = reactionGroups.map(group => ({
      type: group.type,
      count: group._count.type,
    })).sort((a, b) => b.count - a.count);

    const result = {
      total,
      reactions,
      userReaction: userReaction?.type || null,
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    
    return result;
  }

  async getMediaReactionUsers(
    mediaId: string,
    userId: string,
    type?: ReactionType,
    page: number = 1,
    limit: number = 20,
  ) {
    const media = await this.db.media.findUnique({
      where: { id: mediaId },
      select: { id: true },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const skip = (page - 1) * limit;
    const where = { mediaId, ...(type && { type }) };

    const [reactions, total] = await Promise.all([
      this.db.mediaReaction.findMany({
        where,
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
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.mediaReaction.count({ where }),
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

  
  async createMediaComment(
    userId: string,
    mediaId: string,
    dto: CreateMediaCommentDto,
  ) {
    
    const media = await this.db.media.findUnique({
      where: { id: mediaId },
      include: {
        post: {
          select: {
            id: true,
            authorId: true,
          },
        },
      },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const comment = await this.db.$transaction(async (tx) => {
      const newComment = await tx.mediaComment.create({
        data: {
          content: dto.content,
          authorId: userId,
          mediaId: mediaId,
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

     
      if (media.post.authorId !== userId) {
        await tx.notification.create({
          data: {
            receiverId: media.post.authorId,
            type: 'MEDIA_COMMENT',
            senderId: userId,
            postId: media.post.id,
            metadata: {
              mediaId: mediaId,
              content: dto.content.substring(0, 100),
              mediaType: media.type,
            },
          },
        });
      }

      return newComment;
    });

   
    await this.invalidateMediaCommentsCache(mediaId);

    return comment;
  }

  async getMediaComments(
    mediaId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'newest',
  ) {
    const cacheKey = `${this.MEDIA_COMMENTS_PREFIX}${mediaId}:${userId}:${page}:${limit}:${sortBy}`;
    
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const media = await this.db.media.findUnique({
      where: { id: mediaId },
      select: { id: true },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const skip = (page - 1) * limit;
    const orderBy = sortBy === 'oldest' 
    ? { createdAt: 'asc' as const }  
    : { createdAt: 'desc' as const }

    const [comments, total] = await Promise.all([
      this.db.mediaComment.findMany({
        where: { mediaId },
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
        orderBy,
        skip,
        take: limit,
      }),
      this.db.mediaComment.count({
        where: { mediaId },
      }),
    ]);

    const result = {
      data: comments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    
    return result;
  }

  async updateMediaComment(
    userId: string,
    commentId: string,
    content: string,
  ) {
    const comment = await this.db.mediaComment.findFirst({
      where: {
        id: commentId,
        authorId: userId,
      },
      include: {
        media: {
          select: { id: true },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found or you are not the author');
    }

    const updated = await this.db.mediaComment.update({
      where: { id: commentId },
      data: { content },
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

    await this.invalidateMediaCommentsCache(comment.media.id);

    return updated;
  }

  async deleteMediaComment(userId: string, commentId: string) {
    const comment = await this.db.mediaComment.findFirst({
      where: {
        id: commentId,
        authorId: userId,
      },
      include: {
        media: {
          select: { id: true },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found or you are not the author');
    }

    await this.db.mediaComment.delete({
      where: { id: commentId },
    });

    await this.invalidateMediaCommentsCache(comment.media.id);

    return { success: true, message: 'Comment deleted successfully' };
  }

  // ============ BATCH OPERATIONS FOR FEEDS ============

  async getBatchMediaReactions(mediaIds: string[], userId: string) {
    if (!mediaIds.length) return {};

    const cacheKey = `media:reactions:batch:${userId}:${mediaIds.sort().join(',')}`;
    
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const reactions = await this.db.mediaReaction.findMany({
      where: {
        mediaId: { in: mediaIds },
      },
      select: {
        mediaId: true,
        type: true,
        userId: true,
      },
    });

    const reactionMap = new Map();
    
    mediaIds.forEach(mediaId => {
      reactionMap.set(mediaId, {
        total: 0,
        reactions: {} as Record<ReactionType, number>,
        userReaction: null as ReactionType | null,
      });
    });

    reactions.forEach(reaction => {
      const mediaData = reactionMap.get(reaction.mediaId);
      if (mediaData) {
        mediaData.total++;
        const type = reaction.type as ReactionType;
        mediaData.reactions[type] = (mediaData.reactions[type] || 0) + 1;
        
        if (reaction.userId === userId) {
          mediaData.userReaction = type;
        }
      }
    });

    const result = Object.fromEntries(
      Array.from(reactionMap.entries()).map(([id, data]) => [
        id,
        {
          total: data.total,
          userReaction: data.userReaction,
          topReaction: Object.entries(data.reactions as Record<ReactionType, number>)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || null,
          reactions: Object.entries(data.reactions as Record<ReactionType, number>)
            .map(([type, count]) => ({ type, count })),
        },
      ])
    );

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    
    return result;
  }

  // ============ HELPER METHODS ============

  private async invalidateMediaReactionsCache(mediaId: string) {
    const keys = await this.redis.keys(`${this.MEDIA_REACTIONS_PREFIX}${mediaId}:*`);
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  private async invalidateMediaCommentsCache(mediaId: string) {
    const keys = await this.redis.keys(`${this.MEDIA_COMMENTS_PREFIX}${mediaId}:*`);
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  async getMediaWithDetails(mediaId: string, userId: string) {
    const cacheKey = `${this.MEDIA_CACHE_PREFIX}${mediaId}:${userId}`;
    
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const media = await this.db.media.findUnique({
      where: { id: mediaId },
      include: {
        post: {
          select: {
            id: true,
            content: true,
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
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const [reactions, commentsCount] = await Promise.all([
      this.getMediaReactionSummary(mediaId, userId),
      this.db.mediaComment.count({ where: { mediaId } }),
    ]);

    const result = {
      ...media,
      reactions,
      commentsCount,
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    
    return result;
  }
}