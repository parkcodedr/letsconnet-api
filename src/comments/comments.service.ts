import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import { ReactionType } from 'src/posts/types';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class CommentsService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly COMMENT_CACHE_PREFIX = 'comment:';
  private readonly POST_COMMENTS_PREFIX = 'post_comments:';
  private readonly COMMENT_REPLIES_PREFIX = 'comment_replies:';

  constructor(
    private db: DatabaseService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async createComment(userId: string, postId: string, dto: CreateCommentDto) {
    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (dto.parentId) {
      const parentComment = await this.db.comment.findUnique({
        where: { id: dto.parentId },
        select: { id: true, postId: true, authorId: true },
      });

      if (!parentComment) {
        throw new NotFoundException('Parent comment not found');
      }

      if (parentComment.postId !== postId) {
        throw new BadRequestException('Reply must be on the same post');
      }
    }

    const result = await this.db.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          content: dto.content,
          authorId: userId,
          postId: postId,
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
        await tx.comment.update({
          where: { id: dto.parentId },
          data: { repliesCount: { increment: 1 } },
        });
      } else {
        await tx.post.update({
          where: { id: postId },
          data: { commentsCount: { increment: 1 } },
        });
      }

      if (post.authorId !== userId) {
        await tx.notification.create({
          data: {
            receiverId: post.authorId,
            type: dto.parentId ? 'COMMENT_REPLY' : 'POST_COMMENT',
            senderId: userId,
            postId: postId,
            commentId: comment.id,
            metadata: {
              content: dto.content.substring(0, 100),
              parentId: dto.parentId,
            },
          },
        });
      }

      if (dto.parentId) {
        const parentComment = await tx.comment.findUnique({
          where: { id: dto.parentId },
          select: { authorId: true },
        });

        if (
          parentComment &&
          parentComment.authorId !== userId &&
          parentComment.authorId !== post.authorId
        ) {
          await tx.notification.create({
            data: {
              receiverId: parentComment.authorId,
              type: 'COMMENT_REPLY',
              senderId: userId,
              postId: postId,
              commentId: comment.id,
              metadata: {
                content: dto.content.substring(0, 100),
                parentId: dto.parentId,
              },
            },
          });
        }
      }

      return comment;
    });

    await this.invalidatePostCommentsCache(postId);
    if (dto.parentId) {
      await this.invalidateCommentRepliesCache(dto.parentId);
    }

    return result;
  }

  async getPostComments(
    postId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'newest',
  ) {
    const cacheKey = `${this.POST_COMMENTS_PREFIX}${postId}:${userId}:${page}:${limit}:${sortBy}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const post = await this.db.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
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
      this.db.comment.findMany({
        where: {
          postId,
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
      this.db.comment.count({
        where: {
          postId,
          parentId: null,
        },
      }),
    ]);

    const commentIds = comments.map((c) => c.id);
    const reactionCounts = await this.db.commentReaction.groupBy({
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
      ...comment,
      reactions: reactionMap.get(comment.id) || [],
      userReaction: comment.reactions[0]?.type || null,
      reactionsCount: comment._count.reactions,
      repliesCount: comment._count.replies,
      _count: undefined,
      reactions_raw: undefined,
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

  async getCommentReplies(
    commentId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const cacheKey = `${this.COMMENT_REPLIES_PREFIX}${commentId}:${userId}:${page}:${limit}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const parentComment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: { id: true, postId: true },
    });

    if (!parentComment) {
      throw new NotFoundException('Comment not found');
    }

    const skip = (page - 1) * limit;

    const [replies, total] = await Promise.all([
      this.db.comment.findMany({
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
      this.db.comment.count({
        where: { parentId: commentId },
      }),
    ]);

    const replyIds = replies.map((r) => r.id);
    const reactionCounts = await this.db.commentReaction.groupBy({
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
      ...reply,
      reactions: reactionMap.get(reply.id) || [],
      userReaction: reply.reactions[0]?.type || null,
      reactionsCount: reply._count.reactions,
      repliesCount: reply._count.replies,
      _count: undefined,
      reactions_raw: undefined,
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

  async updateComment(userId: string, commentId: string, content: string) {
    const comment = await this.db.comment.findFirst({
      where: {
        id: commentId,
        authorId: userId,
      },
    });

    if (!comment) {
      throw new NotFoundException(
        'Comment not found or you are not the author',
      );
    }

    const updated = await this.db.comment.update({
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

    await this.invalidateCommentCache(commentId, comment.postId);

    return updated;
  }

  async deleteComment(userId: string, commentId: string) {
    const comment = await this.db.comment.findFirst({
      where: {
        id: commentId,
        authorId: userId,
      },
      include: {
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
      await tx.comment.delete({
        where: { id: commentId },
      });

      if (comment.parentId) {
        await tx.comment.update({
          where: { id: comment.parentId },
          data: { repliesCount: { decrement: 1 } },
        });
      } else {
        await tx.post.update({
          where: { id: comment.postId },
          data: {
            commentsCount: {
              decrement: 1 + comment._count.replies,
            },
          },
        });
      }
    });

    await this.invalidateCommentCache(commentId, comment.postId);
    if (comment.parentId) {
      await this.invalidateCommentRepliesCache(comment.parentId);
    }

    return { success: true, message: 'Comment deleted successfully' };
  }

  // 1. Enhanced reactToComment with better reply handling
  async reactToComment(
    userId: string,
    commentId: string,
    type: ReactionType | null,
  ) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        authorId: true,
        postId: true,
        parentId: true, // Include to check if it's a reply
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment or reply not found');
    }

    const result = await this.db.$transaction(async (tx) => {
      const existing = await tx.commentReaction.findUnique({
        where: {
          userId_commentId: {
            userId,
            commentId,
          },
        },
      });

      // Remove reaction if same type or type is null
      if (!type || (existing && existing.type === type)) {
        if (existing) {
          await tx.commentReaction.delete({ where: { id: existing.id } });
          await tx.comment.update({
            where: { id: commentId },
            data: { reactionsCount: { decrement: 1 } },
          });
        }
        return { reacted: false, type: null, isReply: !!comment.parentId };
      }

      // Update existing reaction to different type
      if (existing) {
        await tx.commentReaction.update({
          where: { id: existing.id },
          data: { type },
        });
        return { reacted: true, type, isReply: !!comment.parentId };
      }

      // Create new reaction
      await tx.commentReaction.create({
        data: { userId, commentId, type },
      });
      await tx.comment.update({
        where: { id: commentId },
        data: { reactionsCount: { increment: 1 } },
      });

      // Create notification for comment/reply author
      if (comment.authorId !== userId) {
        await tx.notification.create({
          data: {
            receiverId: comment.authorId,
            type: 'COMMENT_LIKE',
            senderId: userId,
            postId: comment.postId,
            commentId: commentId,
            metadata: {
              reactionType: type,
              isReply: !!comment.parentId,
              parentCommentId: comment.parentId,
            },
          },
        });
      }

      return { reacted: true, type, isReply: !!comment.parentId };
    });

    // Invalidate both comment and its parent reply cache if it's a reply
    await this.invalidateCommentCache(commentId, comment.postId);
    if (comment.parentId) {
      await this.invalidateCommentRepliesCache(comment.parentId);
    }

    return result;
  }

  async getBatchCommentsReactions(commentIds: string[], userId: string) {
    if (!commentIds.length) return {};

    const cacheKey = `comment_reactions:batch:${userId}:${commentIds.sort().join(',')}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const reactions = await this.db.commentReaction.findMany({
      where: {
        commentId: { in: commentIds },
      },
      select: {
        commentId: true,
        type: true,
        userId: true,
      },
    });

    const userReactions = reactions.filter((r) => r.userId === userId);

    const reactionMap = new Map();

    commentIds.forEach((commentId) => {
      reactionMap.set(commentId, {
        total: 0,
        reactions: {} as Record<ReactionType, number>,
        userReaction: null as ReactionType | null,
      });
    });

    reactions.forEach((reaction) => {
      const commentData = reactionMap.get(reaction.commentId);
      if (commentData) {
        commentData.total++;
        commentData.reactions[reaction.type] =
          (commentData.reactions[reaction.type] || 0) + 1;
      }
    });

    userReactions.forEach((reaction) => {
      const commentData = reactionMap.get(reaction.commentId);
      if (commentData) {
        commentData.userReaction = reaction.type;
      }
    });

    const result = Object.fromEntries(
      Array.from(reactionMap.entries()).map(([id, data]) => [
        id,
        {
          total: data.total,
          userReaction: data.userReaction,
          reactions: Object.entries(data.reactions).map(([type, count]) => ({
            type,
            count,
          })),
        },
      ]),
    );

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  // 3. Get reaction users for a specific comment or reply
  async getCommentReactionUsers(
    commentId: string,
    userId: string,
    type?: ReactionType,
    page: number = 1,
    limit: number = 20,
  ) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });

    if (!comment) {
      throw new NotFoundException('Comment or reply not found');
    }

    const skip = (page - 1) * limit;
    const where = { commentId, ...(type && { type }) };

    const [reactions, total] = await Promise.all([
      this.db.commentReaction.findMany({
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
      this.db.commentReaction.count({ where }),
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

  // 4. Get user's reactions across all comments and replies
  async getUserCommentReactions(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const [reactions, total] = await Promise.all([
      this.db.commentReaction.findMany({
        where: { userId },
        include: {
          comment: {
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
              post: {
                select: {
                  id: true,
                  content: true,
                },
              },
              parent: {
                select: {
                  id: true,
                  content: true,
                  author: {
                    select: {
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
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.commentReaction.count({ where: { userId } }),
    ]);

    return {
      data: reactions.map((reaction) => ({
        comment: reaction.comment,
        reactionType: reaction.type,
        reactedAt: reaction.createdAt,
        context: {
          isReply: !!reaction.comment.parentId,
          parentComment: reaction.comment.parent,
          post: reaction.comment.post,
        },
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async invalidatePostCommentsCache(postId: string) {
    const keys = await this.redis.keys(
      `${this.POST_COMMENTS_PREFIX}${postId}:*`,
    );
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  private async invalidateCommentRepliesCache(commentId: string) {
    const keys = await this.redis.keys(
      `${this.COMMENT_REPLIES_PREFIX}${commentId}:*`,
    );
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  private async invalidateCommentCache(commentId: string, postId: string) {
    await this.redis.del(`${this.COMMENT_CACHE_PREFIX}${commentId}`);
    await this.invalidatePostCommentsCache(postId);
  }

  async getCommentWithContext(commentId: string, userId: string) {
    const comment = await this.db.comment.findFirst({
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
        post: {
          select: {
            id: true,
            content: true,
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
      _count: undefined,
      reactions_raw: undefined,
    };
  }
}
