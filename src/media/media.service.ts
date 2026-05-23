import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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

    const total = reactionGroups.reduce(
      (sum, group) => sum + group._count.type,
      0,
    );
    const reactions = reactionGroups
      .map((group) => ({
        type: group.type,
        count: group._count.type,
      }))
      .sort((a, b) => b.count - a.count);

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
      data: reactions.map((reaction) => ({
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

    if (dto.parentId) {
      const parentComment = await this.db.mediaComment.findUnique({
        where: { id: dto.parentId },
        select: { id: true, mediaId: true, authorId: true },
      });

      if (!parentComment) {
        throw new NotFoundException('Parent comment not found');
      }

      if (parentComment.mediaId !== mediaId) {
        throw new BadRequestException('Reply must be on the same media');
      }
    }

    const comment = await this.db.$transaction(async (tx) => {
      const newComment = await tx.mediaComment.create({
        data: {
          content: dto.content,
          authorId: userId,
          mediaId: mediaId,
          parentId: dto.parentId || null,
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

      if (dto.parentId) {
        await tx.mediaComment.update({
          where: { id: dto.parentId },
          data: { repliesCount: { increment: 1 } },
        });
      }

      if (media.post.authorId !== userId) {
        await tx.notification.create({
          data: {
            receiverId: media.post.authorId,
            type: dto.parentId ? 'COMMENT_REPLY' : 'MEDIA_COMMENT',
            senderId: userId,
            postId: media.post.id,
            metadata: {
              mediaId: mediaId,
              content: dto.content.substring(0, 100),
              mediaType: media.type,
              parentId: dto.parentId,
            },
          },
        });
      }

      if (dto.parentId) {
        const parentComment = await tx.mediaComment.findUnique({
          where: { id: dto.parentId },
          select: { authorId: true },
        });

        if (
          parentComment &&
          parentComment.authorId !== userId &&
          parentComment.authorId !== media.post.authorId
        ) {
          await tx.notification.create({
            data: {
              receiverId: parentComment.authorId,
              type: 'COMMENT_REPLY',
              senderId: userId,
              postId: media.post.id,
              metadata: {
                mediaId: mediaId,
                content: dto.content.substring(0, 100),
                parentId: dto.parentId,
              },
            },
          });
        }
      }

      return newComment;
    });

    if (dto.parentId) {
      await this.invalidateMediaCommentRepliesCache(dto.parentId);
    } else {
      await this.invalidateMediaCommentsCache(mediaId);
    }

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

    let orderBy: any = {};
    switch (sortBy) {
      case 'oldest':
        orderBy = { createdAt: 'asc' };
        break;
      case 'most_reactions':
        orderBy = { reactionsCount: 'desc' };
        break;
      default:
        orderBy = { createdAt: 'desc' };
    }

    const [comments, total] = await Promise.all([
      this.db.mediaComment.findMany({
        where: {
          mediaId,
          parentId: null,
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
          reactions: {
            where: { userId },
            select: { type: true },
          },
          _count: {
            select: {
              reactions: true,
              replies: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.db.mediaComment.count({
        where: { mediaId, parentId: null },
      }),
    ]);

    const commentIds = comments.map((c) => c.id);
    const reactionCounts = await this.db.mediaCommentReaction.groupBy({
      by: ['commentId', 'type'],
      where: {
        commentId: { in: commentIds },
      },
      _count: { type: true },
    });

    const reactionMap = new Map();
    reactionCounts.forEach((reaction) => {
      if (!reactionMap.has(reaction.commentId)) {
        reactionMap.set(reaction.commentId, []);
      }
      reactionMap.get(reaction.commentId).push({
        type: reaction.type,
        count: reaction._count.type,
      });
    });

    const enrichedComments = comments.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: comment.author,
      reactions: reactionMap.get(comment.id) || [],
      userReaction: comment.reactions[0]?.type || null,
      reactionsCount: comment._count.reactions,
      repliesCount: comment._count.replies,
    }));

    const result = {
      data: enrichedComments,
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

  async getMediaCommentReplies(
    commentId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const cacheKey = `media:comment_replies:${commentId}:${userId}:${page}:${limit}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const parentComment = await this.db.mediaComment.findUnique({
      where: { id: commentId },
      select: { id: true, mediaId: true },
    });

    if (!parentComment) {
      throw new NotFoundException('Comment not found');
    }

    const skip = (page - 1) * limit;

    const [replies, total] = await Promise.all([
      this.db.mediaComment.findMany({
        where: {
          parentId: commentId,
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
          reactions: {
            where: { userId },
            select: { type: true },
          },
          _count: {
            select: {
              reactions: true,
              replies: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.db.mediaComment.count({
        where: { parentId: commentId },
      }),
    ]);

    const replyIds = replies.map((r) => r.id);
    const reactionCounts = await this.db.mediaCommentReaction.groupBy({
      by: ['commentId', 'type'],
      where: {
        commentId: { in: replyIds },
      },
      _count: { type: true },
    });

    const reactionMap = new Map();
    reactionCounts.forEach((reaction) => {
      if (!reactionMap.has(reaction.commentId)) {
        reactionMap.set(reaction.commentId, []);
      }
      reactionMap.get(reaction.commentId).push({
        type: reaction.type,
        count: reaction._count.type,
      });
    });

    const enrichedReplies = replies.map((reply) => ({
      id: reply.id,
      content: reply.content,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
      author: reply.author,
      reactions: reactionMap.get(reply.id) || [],
      userReaction: reply.reactions[0]?.type || null,
      reactionsCount: reply._count.reactions,
      repliesCount: reply._count.replies,
    }));

    const result = {
      data: enrichedReplies,
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

  async getMediaCommentWithContext(commentId: string, userId: string) {
    const comment = await this.db.mediaComment.findFirst({
      where: { id: commentId },
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
          select: {
            id: true,
            type: true,
            url: true,
          },
        },
        parent: {
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
                  },
                },
              },
            },
          },
        },
        reactions: {
          where: { userId },
          select: { type: true },
        },
        _count: {
          select: {
            reactions: true,
            replies: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return {
      ...comment,
      userReaction: comment.reactions[0]?.type || null,
      reactionsCount: comment._count.reactions,
      repliesCount: comment._count.replies,
    };
  }

  async getMediaCommentReactionUsers(
    commentId: string,
    userId: string,
    type?: ReactionType,
    page: number = 1,
    limit: number = 20,
  ) {
    const comment = await this.db.mediaComment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const skip = (page - 1) * limit;
    const where = { commentId, ...(type && { type }) };

    const [reactions, total] = await Promise.all([
      this.db.mediaCommentReaction.findMany({
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
      this.db.mediaCommentReaction.count({ where }),
    ]);

    return {
      data: reactions.map((reaction) => ({
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

  async reactToMediaComment(
    userId: string,
    commentId: string,
    type: ReactionType | null,
  ) {
    const comment = await this.db.mediaComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        authorId: true,
        media: {
          select: {
            postId: true,
          },
        },
        parentId: true,
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment or reply not found');
    }

    const result = await this.db.$transaction(async (tx) => {
      const existing = await tx.mediaCommentReaction.findUnique({
        where: {
          userId_commentId: {
            userId,
            commentId,
          },
        },
      });

      if (!type || (existing && existing.type === type)) {
        if (existing) {
          await tx.mediaCommentReaction.delete({ where: { id: existing.id } });
          await tx.mediaComment.update({
            where: { id: commentId },
            data: { reactionsCount: { decrement: 1 } },
          });
        }
        return { reacted: false, type: null, isReply: !!comment.parentId };
      }

      if (existing) {
        await tx.mediaCommentReaction.update({
          where: { id: existing.id },
          data: { type },
        });
        return { reacted: true, type, isReply: !!comment.parentId };
      }

      await tx.mediaCommentReaction.create({
        data: { userId, commentId, type },
      });
      await tx.mediaComment.update({
        where: { id: commentId },
        data: { reactionsCount: { increment: 1 } },
      });

      if (comment.authorId !== userId) {
        await tx.notification.create({
          data: {
            receiverId: comment.authorId,
            type: 'COMMENT_LIKE',
            senderId: userId,
            postId: comment.media.postId,
            metadata: {
              reactionType: type,
              isReply: !!comment.parentId,
              parentCommentId: comment.parentId,
              commentId: commentId,
            },
          },
        });
      }

      return { reacted: true, type, isReply: !!comment.parentId };
    });

    await this.invalidateMediaCommentCache(commentId);
    if (comment.parentId) {
      await this.invalidateMediaCommentRepliesCache(comment.parentId);
    }

    return result;
  }

  async updateMediaComment(userId: string, commentId: string, content: string) {
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
      throw new NotFoundException(
        'Comment not found or you are not the author',
      );
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

    await this.invalidateMediaCommentCache(commentId);
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
        _count: {
          select: { replies: true },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException(
        'Comment not found or you are not the author',
      );
    }

    await this.db.$transaction(async (tx) => {
      await tx.mediaComment.delete({
        where: { id: commentId },
      });

      if (comment.parentId) {
        await tx.mediaComment.update({
          where: { id: comment.parentId },
          data: { repliesCount: { decrement: 1 } },
        });
      }
    });

    await this.invalidateMediaCommentCache(commentId);
    if (comment.parentId) {
      await this.invalidateMediaCommentRepliesCache(comment.parentId);
    }

    return { success: true, message: 'Comment deleted successfully' };
  }

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

    mediaIds.forEach((mediaId) => {
      reactionMap.set(mediaId, {
        total: 0,
        reactions: {} as Record<ReactionType, number>,
        userReaction: null as ReactionType | null,
      });
    });

    reactions.forEach((reaction) => {
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
          topReaction:
            Object.entries(data.reactions as Record<ReactionType, number>).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0] || null,
          reactions: Object.entries(
            data.reactions as Record<ReactionType, number>,
          ).map(([type, count]) => ({ type, count })),
        },
      ]),
    );

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    return result;
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

  // ============ HELPER METHODS ============

  private async invalidateMediaReactionsCache(mediaId: string) {
    const keys = await this.redis.keys(
      `${this.MEDIA_REACTIONS_PREFIX}${mediaId}:*`,
    );
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  private async invalidateMediaCommentsCache(mediaId: string) {
    const keys = await this.redis.keys(
      `${this.MEDIA_COMMENTS_PREFIX}${mediaId}:*`,
    );
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  private async invalidateMediaCommentRepliesCache(commentId: string) {
    const keys = await this.redis.keys(`media:comment_replies:${commentId}:*`);
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  private async invalidateMediaCommentCache(commentId: string) {
    await this.redis.del(`media:comment:${commentId}`);
    const comment = await this.db.mediaComment.findUnique({
      where: { id: commentId },
      select: { mediaId: true, parentId: true },
    });
    if (comment) {
      await this.invalidateMediaCommentsCache(comment.mediaId);
      if (comment.parentId) {
        await this.invalidateMediaCommentRepliesCache(comment.parentId);
      }
    }
  }
}