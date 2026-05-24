import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import Redis from 'ioredis';
import { FriendshipStatus } from './dto/friendship.dto';

@Injectable()
export class FriendshipService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly FRIENDS_CACHE_PREFIX = 'friends:';
  private readonly FRIEND_REQUESTS_CACHE_PREFIX = 'friend_requests:';
  private readonly REQUEST_LIMIT_PER_DAY = 50;

  constructor(
    private db: DatabaseService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async sendFriendRequest(requesterId: string, receiverId: string) {
    if (requesterId === receiverId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    const receiver = await this.db.user.findUnique({
      where: { id: receiverId },
      select: { id: true, isDisabled: true },
    });

    if (!receiver || receiver.isDisabled) {
      throw new NotFoundException('User not found');
    }

    await this.checkRateLimit(requesterId);

    const existingFriendship = await this.db.friendship.findFirst({
      where: {
        OR: [
          { requesterId, receiverId },
          { requesterId: receiverId, receiverId: requesterId },
        ],
      },
    });

    if (existingFriendship) {
      switch (existingFriendship.status) {
        case FriendshipStatus.ACCEPTED:
          throw new ConflictException('You are already friends');
        case FriendshipStatus.PENDING:
          if (existingFriendship.requesterId === requesterId) {
            throw new ConflictException('Friend request already sent');
          } else {
            return this.acceptFriendRequest(receiverId, requesterId);
          }
        case FriendshipStatus.BLOCKED:
          throw new ForbiddenException(
            'Cannot send friend request to this user',
          );
        case FriendshipStatus.DECLINED:
          await this.db.friendship.delete({
            where: { id: existingFriendship.id },
          });
          break;
      }
    }

    const friendship = await this.db.$transaction(async (tx) => {
      const newRequest = await tx.friendship.create({
        data: {
          requesterId,
          receiverId,
          status: FriendshipStatus.PENDING,
          actionUserId: requesterId,
          requestCount: 1,
        },
        include: {
          requester: {
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
          receiver: {
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

      await this.updateRateLimit(requesterId);

      await tx.notification.create({
        data: {
          receiverId: receiverId,
          type: 'FRIEND_REQUEST',
          senderId: requesterId,
          metadata: {
            friendshipId: newRequest.id,
          },
        },
      });

      return newRequest;
    });

    await this.invalidateUserFriendsCache(requesterId);
    await this.invalidateUserFriendsCache(receiverId);
    await this.invalidateFriendRequestsCache(receiverId);

    return {
      message: 'Friend request sent successfully',
      friendship,
    };
  }

  async acceptFriendRequest(userId: string, requesterId: string) {
    console.log({ userId, requesterId });

    const friendship = await this.db.friendship.findFirst({
      where: {
        requesterId,
        receiverId: userId,
        status: FriendshipStatus.PENDING,
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    const updated = await this.db.$transaction(async (tx) => {
      const updatedFriendship = await tx.friendship.update({
        where: { id: friendship.id },
        data: {
          status: FriendshipStatus.ACCEPTED,
          actionUserId: userId,
          respondedAt: new Date(),
        },
        include: {
          requester: {
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
          receiver: {
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

      await tx.notification.create({
        data: {
          receiverId: requesterId,
          type: 'FRIEND_ACCEPTED',
          senderId: userId,
          metadata: {
            friendshipId: updatedFriendship.id,
          },
        },
      });

      return updatedFriendship;
    });

    await this.invalidateUserFriendsCache(userId);
    await this.invalidateUserFriendsCache(requesterId);
    await this.invalidateFriendRequestsCache(userId);

    return {
      message: 'Friend request accepted',
      friendship: updated,
    };
  }

  async declineFriendRequest(userId: string, requesterId: string) {
    const friendship = await this.db.friendship.findFirst({
      where: {
        requesterId,
        receiverId: userId,
        status: FriendshipStatus.PENDING,
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    const updated = await this.db.$transaction(async (tx) => {
      const updatedFriendship = await tx.friendship.update({
        where: { id: friendship.id },
        data: {
          status: FriendshipStatus.DECLINED,
          actionUserId: userId,
          respondedAt: new Date(),
        },
      });

      await this.invalidateFriendRequestsCache(userId);

      return updatedFriendship;
    });

    return {
      message: 'Friend request declined',
      friendship: updated,
    };
  }

  async unfriend(userId: string, friendId: string) {
    const friendship = await this.db.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, receiverId: friendId },
          { requesterId: friendId, receiverId: userId },
        ],
        status: FriendshipStatus.ACCEPTED,
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    await this.db.$transaction(async (tx) => {
      await tx.friendship.delete({ where: { id: friendship.id } });
    });

    await this.invalidateUserFriendsCache(userId);
    await this.invalidateUserFriendsCache(friendId);

    return {
      message: 'Friend removed successfully',
    };
  }

  async blockUser(userId: string, blockedUserId: string) {
    if (userId === blockedUserId) {
      throw new BadRequestException('Cannot block yourself');
    }

    const existingFriendship = await this.db.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, receiverId: blockedUserId },
          { requesterId: blockedUserId, receiverId: userId },
        ],
      },
    });

    await this.db.$transaction(async (tx) => {
      if (existingFriendship) {
        await tx.friendship.delete({ where: { id: existingFriendship.id } });
      }

      await tx.friendship.create({
        data: {
          requesterId: userId,
          receiverId: blockedUserId,
          status: FriendshipStatus.BLOCKED,
          actionUserId: userId,
        },
      });
    });

    await this.invalidateUserFriendsCache(userId);
    await this.invalidateUserFriendsCache(blockedUserId);

    return {
      message: 'User blocked successfully',
    };
  }

  async unblockUser(userId: string, blockedUserId: string) {
    const block = await this.db.friendship.findFirst({
      where: {
        requesterId: userId,
        receiverId: blockedUserId,
        status: FriendshipStatus.BLOCKED,
      },
    });

    if (!block) {
      throw new NotFoundException('Block not found');
    }

    await this.db.friendship.delete({ where: { id: block.id } });

    await this.invalidateUserFriendsCache(userId);
    await this.invalidateUserFriendsCache(blockedUserId);

    return {
      message: 'User unblocked successfully',
    };
  }

  async getFriends(
    userId: string,
    page: number = 1,
    limit: number = 20,
    search?: string,
    sortBy: string = 'recent',
  ) {
    const cacheKey = `${this.FRIENDS_CACHE_PREFIX}${userId}:${page}:${limit}:${search}:${sortBy}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const skip = (page - 1) * limit;

    const friendships = await this.db.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      select: {
        id: true,
        createdAt: true,
        requesterId: true,
        receiverId: true,
      },
    });

  
    const friendIds = friendships.map((f) =>
      f.requesterId === userId ? f.receiverId : f.requesterId,
    );

    if (friendIds.length === 0) {
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
          hasMore: false,
        },
      };
    }

    // Build query for friends with their profiles
    let userWhere: any = {
      id: { in: friendIds },
    };

    // Add search condition
    if (search) {
      userWhere = {
        id: { in: friendIds },
        profile: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    // Build orderBy
    let userOrderBy: any = {};
    switch (sortBy) {
      case 'name':
        userOrderBy = { profile: { firstName: 'asc' } };
        break;
      case 'oldest':
        userOrderBy = { createdAt: 'asc' };
        break;
      default:
        userOrderBy = { createdAt: 'desc' };
    }

    // Get friends with their profiles
    const [friends, total] = await Promise.all([
      this.db.user.findMany({
        where: userWhere,
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
          createdAt: true,
        },
        orderBy: userOrderBy,
        skip,
        take: limit,
      }),
      this.db.user.count({ where: userWhere }),
    ]);

    const friendshipMap = new Map();
    friendships.forEach((f) => {
      const friendId = f.requesterId === userId ? f.receiverId : f.requesterId;
      friendshipMap.set(friendId, {
        friendshipId: f.id,
        since: f.createdAt,
      });
    });

    const result = {
      data: friends.map((friend) => ({
        id: friend.id,
        profile: friend.profile,
        friendshipId: friendshipMap.get(friend.id)?.friendshipId,
        since: friendshipMap.get(friend.id)?.since,
      })),
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
  async getPendingRequests(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const cacheKey = `${this.FRIEND_REQUESTS_CACHE_PREFIX}${userId}:${page}:${limit}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      this.db.friendship.findMany({
        where: {
          receiverId: userId,
          status: FriendshipStatus.PENDING,
        },
        include: {
          requester: {
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
      this.db.friendship.count({
        where: {
          receiverId: userId,
          status: FriendshipStatus.PENDING,
        },
      }),
    ]);

    const result = {
      data: requests.map((req) => ({
        id: req.id,
        user: req.requester,
        requestedAt: req.createdAt,
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

  async getFriendshipStatus(userId: string, targetUserId: string) {
    const friendship = await this.db.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, receiverId: targetUserId },
          { requesterId: targetUserId, receiverId: userId },
        ],
      },
      select: {
        status: true,
        id: true,
        requesterId: true,
        receiverId: true,
      },
    });

    return {
      status: friendship?.status || null,
      isFriend: friendship?.status === FriendshipStatus.ACCEPTED,
      isPending: friendship?.status === FriendshipStatus.PENDING,
      isBlocked: friendship?.status === FriendshipStatus.BLOCKED,
      direction: friendship
        ? {
            isRequester: friendship.requesterId === userId,
            isReceiver: friendship.receiverId === userId,
          }
        : null,
      friendshipId: friendship?.id || null,
    };
  }

  async getMutualFriends(userId: string, targetUserId: string) {
    const [userFriends, targetFriends] = await Promise.all([
      this.db.friendship.findMany({
        where: {
          status: FriendshipStatus.ACCEPTED,
          OR: [{ requesterId: userId }, { receiverId: userId }],
        },
        select: {
          requesterId: true,
          receiverId: true,
        },
      }),
      this.db.friendship.findMany({
        where: {
          status: FriendshipStatus.ACCEPTED,
          OR: [{ requesterId: targetUserId }, { receiverId: targetUserId }],
        },
        select: {
          requesterId: true,
          receiverId: true,
        },
      }),
    ]);

    const userFriendIds = new Set(
      userFriends.map((f) =>
        f.requesterId === userId ? f.receiverId : f.requesterId,
      ),
    );

    const targetFriendIds = new Set(
      targetFriends.map((f) =>
        f.requesterId === targetUserId ? f.receiverId : f.requesterId,
      ),
    );

    const mutualFriendIds = [...userFriendIds].filter((id) =>
      targetFriendIds.has(id),
    );

    const mutualFriends = await this.db.user.findMany({
      where: { id: { in: mutualFriendIds } },
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
    });

    return {
      count: mutualFriends.length,
      friends: mutualFriends,
    };
  }

  async getFriendSuggestions(userId: string, limit: number = 10) {
    const friends = await this.db.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      select: {
        requesterId: true,
        receiverId: true,
      },
    });

    const friendIds = new Set(
      friends.map((f) =>
        f.requesterId === userId ? f.receiverId : f.requesterId,
      ),
    );
    friendIds.add(userId);

    const friendsOfFriends = await this.db.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: { in: [...friendIds] } },
          { receiverId: { in: [...friendIds] } },
        ],
        NOT: {
          OR: [
            { requesterId: { in: [...friendIds] } },
            { receiverId: { in: [...friendIds] } },
          ],
        },
      },
      select: {
        requesterId: true,
        receiverId: true,
      },
    });

    const suggestionScores = new Map();

    friendsOfFriends.forEach((fof) => {
      const suggestedId = friendIds.has(fof.requesterId)
        ? fof.receiverId
        : fof.requesterId;
      if (!friendIds.has(suggestedId)) {
        suggestionScores.set(
          suggestedId,
          (suggestionScores.get(suggestedId) || 0) + 1,
        );
      }
    });

    const suggestions = await Promise.all(
      Array.from(suggestionScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(async ([userId, score]) => {
          const user = await this.db.user.findUnique({
            where: { id: userId },
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
          });
          return { ...user, mutualFriends: score };
        }),
    );

    return suggestions;
  }

  private async checkRateLimit(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rateLimit = await this.db.friendRequestRateLimit.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    if (rateLimit && rateLimit.requestCount >= this.REQUEST_LIMIT_PER_DAY) {
      throw new BadRequestException(
        `You have reached the daily limit of ${this.REQUEST_LIMIT_PER_DAY} friend requests`,
      );
    }
  }

  private async updateRateLimit(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.db.friendRequestRateLimit.upsert({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
      update: {
        requestCount: { increment: 1 },
      },
      create: {
        userId,
        date: today,
        requestCount: 1,
      },
    });
  }

  private async invalidateUserFriendsCache(userId: string) {
    const keys = await this.redis.keys(
      `${this.FRIENDS_CACHE_PREFIX}${userId}:*`,
    );
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }

  private async invalidateFriendRequestsCache(userId: string) {
    const keys = await this.redis.keys(
      `${this.FRIEND_REQUESTS_CACHE_PREFIX}${userId}:*`,
    );
    if (keys.length) {
      await this.redis.del(...keys);
    }
  }
}
