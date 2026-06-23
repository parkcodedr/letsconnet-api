import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { REDIS_CACHE } from 'src/cache/redis-cache.module';
import Redis from 'ioredis';
import { FriendshipStatus } from './dto/friendship.dto';
import { FriendRequestAction } from './type';
import { FRIEND_REQUEST_ACTION } from 'src/common/constant/friendship';
import { Friendship } from 'generated/prisma/client';
import { PresenceService } from 'src/realtime/services/presence.service';

@Injectable()
export class FriendshipService {
  private readonly CACHE_TTL = 300;
  private readonly SUGGESTIONS_CACHE_TTL = 600;
  private readonly MUTUAL_CACHE_TTL = 300;

  private readonly FRIENDS_CACHE_PREFIX = 'friends:';
  private readonly FRIEND_REQUESTS_CACHE_PREFIX = 'friend_requests:';
  private readonly SUGGESTIONS_CACHE_PREFIX = 'friend_suggestions:';
  private readonly MUTUAL_CACHE_PREFIX = 'mutual_friends:';
  private readonly STATUS_CACHE_PREFIX = 'friendship_status:';

  private readonly REQUEST_LIMIT_PER_DAY = 50;

  constructor(
    private db: DatabaseService,
    @Inject(REDIS_CACHE)
    private readonly redis: Redis,
    private readonly presenceService: PresenceService,
  ) {}

  async sendFriendRequest(requesterId: string, receiverId: string) {
    if (requesterId === receiverId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    const [receiver, rateLimit, existingFriendship] = await Promise.all([
      this.db.user.findUnique({
        where: { id: receiverId },
        select: { id: true, isDisabled: true },
      }),
      this.getRateLimitCount(requesterId),
      this.db.friendship.findFirst({
        where: {
          OR: [
            { requesterId, receiverId },
            { requesterId: receiverId, receiverId: requesterId },
          ],
        },
      }),
    ]);

    if (!receiver || receiver.isDisabled) {
      throw new NotFoundException('User not found');
    }

    if (rateLimit >= this.REQUEST_LIMIT_PER_DAY) {
      throw new BadRequestException(
        `You have reached the daily limit of ${this.REQUEST_LIMIT_PER_DAY} friend requests`,
      );
    }

    if (existingFriendship) {
      switch (existingFriendship.status) {
        case FriendshipStatus.ACCEPTED:
          throw new ConflictException('You are already friends');
        case FriendshipStatus.PENDING:
          if (existingFriendship.requesterId === requesterId) {
            throw new ConflictException('Friend request already sent');
          } else {
            return this.acceptFriendRequest(receiverId, existingFriendship);
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
      const [newRequest] = await Promise.all([
        tx.friendship.create({
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
        }),
        this.incrementRateLimit(requesterId),
      ]);

      await tx.notification.create({
        data: {
          receiverId,
          type: 'FRIEND_REQUEST',
          senderId: requesterId,
          metadata: { friendshipId: newRequest.id },
        },
      });

      return newRequest;
    });

    await Promise.all([
      this.invalidateUserFriendsCache(requesterId),
      this.invalidateUserFriendsCache(receiverId),
      this.invalidateFriendRequestsCache(receiverId),
      this.invalidateStatusCache(requesterId, receiverId),
      this.invalidateSuggestionsCache(requesterId),
    ]);

    return { message: 'Friend request sent successfully', friendship };
  }

  async acceptFriendRequest(userId: string, friendship: Friendship) {
    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    const requesterId = friendship.requesterId;

    const updated = await this.db.$transaction(async (tx) => {
      const [updatedFriendship] = await Promise.all([
        tx.friendship.update({
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
        }),

        tx.notification.create({
          data: {
            receiverId: requesterId,
            type: 'FRIEND_ACCEPTED',
            senderId: userId,
            metadata: {
              friendshipId: friendship.id,
            },
          },
        }),
      ]);

      return updatedFriendship;
    });

    await Promise.all([
      this.invalidateUserFriendsCache(userId),
      this.invalidateUserFriendsCache(requesterId),

      this.invalidateFriendRequestsCache(userId),

      this.invalidateStatusCache(userId, requesterId),

      this.invalidateSuggestionsCache(userId),
      this.invalidateSuggestionsCache(requesterId),
    ]);

    return {
      message: 'Friend request accepted',
      friendship: updated,
    };
  }
  async declineFriendRequest(userId: string, friendship: Friendship) {
    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    const updated = await this.db.friendship.update({
      where: { id: friendship.id },
      data: {
        status: FriendshipStatus.DECLINED,
        actionUserId: userId,
        respondedAt: new Date(),
      },
    });

    await Promise.all([
      this.invalidateFriendRequestsCache(userId),
      this.invalidateStatusCache(userId, friendship.requesterId),
    ]);

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

    if (!friendship) throw new NotFoundException('Friendship not found');

    await this.db.friendship.delete({ where: { id: friendship.id } });

    await Promise.all([
      this.invalidateUserFriendsCache(userId),
      this.invalidateUserFriendsCache(friendId),
      this.invalidateStatusCache(userId, friendId),
      this.invalidateSuggestionsCache(userId),
      this.invalidateSuggestionsCache(friendId),
    ]);

    return { message: 'Friend removed successfully' };
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
      const ops: Promise<any>[] = [
        tx.friendship.create({
          data: {
            requesterId: userId,
            receiverId: blockedUserId,
            status: FriendshipStatus.BLOCKED,
            actionUserId: userId,
          },
        }),
      ];
      if (existingFriendship) {
        ops.push(
          tx.friendship.delete({ where: { id: existingFriendship.id } }),
        );
      }
      await Promise.all(ops);
    });

    await Promise.all([
      this.invalidateUserFriendsCache(userId),
      this.invalidateUserFriendsCache(blockedUserId),
      this.invalidateStatusCache(userId, blockedUserId),
      this.invalidateSuggestionsCache(userId),
    ]);

    return { message: 'User blocked successfully' };
  }

  async unblockUser(userId: string, blockedUserId: string) {
    const block = await this.db.friendship.findFirst({
      where: {
        requesterId: userId,
        receiverId: blockedUserId,
        status: FriendshipStatus.BLOCKED,
      },
    });

    if (!block) throw new NotFoundException('Block not found');

    await this.db.friendship.delete({ where: { id: block.id } });

    await Promise.all([
      this.invalidateUserFriendsCache(userId),
      this.invalidateUserFriendsCache(blockedUserId),
      this.invalidateStatusCache(userId, blockedUserId),
    ]);

    return { message: 'User unblocked successfully' };
  }

  async getFriends(
    userId: string,
    page = 1,
    limit = 20,
    search?: string,
    sortBy = 'recent',
  ) {
    const cacheKey = `${this.FRIENDS_CACHE_PREFIX}${userId}:${page}:${limit}:${search ?? ''}:${sortBy}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

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
        meta: { total: 0, page, limit, totalPages: 0, hasMore: false },
      };
    }

    const userWhere: any = {
      id: { in: friendIds },
      ...(search && {
        profile: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };

    const orderByMap: Record<string, any> = {
      name: { profile: { firstName: 'asc' } },
      oldest: { createdAt: 'asc' },
      recent: { createdAt: 'desc' },
    };

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
        orderBy: orderByMap[sortBy] ?? orderByMap.recent,
        skip,
        take: limit,
      }),
      this.db.user.count({ where: userWhere }),
    ]);

    const friendshipMap = new Map(
      friendships.map((f) => [
        f.requesterId === userId ? f.receiverId : f.requesterId,
        { friendshipId: f.id, since: f.createdAt },
      ]),
    );

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

  async getPendingRequests(userId: string, page = 1, limit = 20) {
    const cacheKey = `${this.FRIEND_REQUESTS_CACHE_PREFIX}${userId}:${page}:${limit}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      this.db.friendship.findMany({
        where: { receiverId: userId, status: FriendshipStatus.PENDING },
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
        where: { receiverId: userId, status: FriendshipStatus.PENDING },
      }),
    ]);

    const result = {
      data: requests.map((req) => ({
        id: req.id,
        user: req.requester,
        requestedAt: req.createdAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    return result;
  }

  async getFriendshipStatus(userId: string, targetUserId: string) {
    const cacheKey = `${this.STATUS_CACHE_PREFIX}${userId}:${targetUserId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const friendship = await this.db.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, receiverId: targetUserId },
          { requesterId: targetUserId, receiverId: userId },
        ],
      },
      select: { status: true, id: true, requesterId: true, receiverId: true },
    });

    const result = {
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

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    return result;
  }

  async getMutualFriends(userId: string, targetUserId: string) {
    const cacheKey = `${this.MUTUAL_CACHE_PREFIX}${[userId, targetUserId].sort().join(':')}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const allFriendships = await this.db.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: userId },
          { receiverId: userId },
          { requesterId: targetUserId },
          { receiverId: targetUserId },
        ],
      },
      select: { requesterId: true, receiverId: true },
    });

    const userFriendIds = new Set<string>();
    const targetFriendIds = new Set<string>();

    allFriendships.forEach((f) => {
      if (f.requesterId === userId || f.receiverId === userId) {
        userFriendIds.add(
          f.requesterId === userId ? f.receiverId : f.requesterId,
        );
      }
      if (f.requesterId === targetUserId || f.receiverId === targetUserId) {
        targetFriendIds.add(
          f.requesterId === targetUserId ? f.receiverId : f.requesterId,
        );
      }
    });

    const mutualFriendIds = [...userFriendIds].filter((id) =>
      targetFriendIds.has(id),
    );

    const mutualFriends =
      mutualFriendIds.length > 0
        ? await this.db.user.findMany({
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
          })
        : [];

    const result = { count: mutualFriends.length, friends: mutualFriends };

    await this.redis.setex(
      cacheKey,
      this.MUTUAL_CACHE_TTL,
      JSON.stringify(result),
    );
    return result;
  }

  async getFriendSuggestions(userId: string, page = 1, limit = 10) {
    const rankedCacheKey = `${this.SUGGESTIONS_CACHE_PREFIX}${userId}:ranked`;

    let allRanked: Array<[string, { score: number; reason: string }]>;

    const cachedRanked = await this.redis.get(rankedCacheKey);
    if (cachedRanked) {
      allRanked = JSON.parse(cachedRanked);
    } else {
      allRanked = await this.computeSuggestions(userId);
      await this.redis.setex(
        rankedCacheKey,
        this.SUGGESTIONS_CACHE_TTL,
        JSON.stringify(allRanked),
      );
    }

    const skip = (page - 1) * limit;
    const total = allRanked.length;
    const pageSlice = allRanked.slice(skip, skip + limit);
    const rankedIds = pageSlice.map(([id]) => id);

    const profiles =
      rankedIds.length > 0
        ? await this.db.user.findMany({
            where: { id: { in: rankedIds } },
            select: {
              id: true,
              profile: {
                select: {
                  firstName: true,
                  lastName: true,
                  username: true,
                  avatarUrl: true,
                  city: true,
                  country: true,
                },
              },
            },
          })
        : [];

    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    console.log('allRanked', allRanked);
    console.log('pageSlice', pageSlice);
    console.log('rankedIds', rankedIds);
    console.log('profiles', profiles);
    console.log({
      page,
      limit,
      skip,
      total: allRanked.length,
    });

    return {
      data: pageSlice
        .map(([id, { score, reason }]) => {
          const profile = profileMap.get(id);
          if (!profile) return null;
          return {
            ...profile,
            mutualFriends: reason === 'mutual_friends' ? Math.round(score) : 0,
            reason,
          };
        })
        .filter(Boolean),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async computeSuggestions(
    userId: string,
  ): Promise<Array<[string, { score: number; reason: string }]>> {
    const suggestions = new Map<string, { score: number; reason: string }>();
    const FETCH_SIZE = 200;

    // ── 1. Build exclusion set — no separate Block model query ──
    const [existingRelationships, currentUser] = await Promise.all([
      this.db.friendship.findMany({
        where: {
          OR: [{ requesterId: userId }, { receiverId: userId }],
        },
        select: { requesterId: true, receiverId: true, status: true },
      }),
      this.db.user.findUnique({
        where: { id: userId },
        select: {
          profile: { select: { city: true, state: true, country: true } },
        },
      }),
    ]);

    const excludedIds = new Set<string>([userId]);
    const friendIds = new Set<string>();

    existingRelationships.forEach((r) => {
      const otherId = r.requesterId === userId ? r.receiverId : r.requesterId;
      excludedIds.add(otherId); // exclude pending, blocked, accepted, declined — all of them
      if (r.status === FriendshipStatus.ACCEPTED) {
        friendIds.add(otherId);
      }
    });

    const excludedArray = [...excludedIds]; // materialize once, reuse

    console.log(
      `[Suggestions] userId=${userId} excluded=${excludedIds.size} friends=${friendIds.size}`,
    );

    // ── Tier 1: Friends of friends ──
    if (friendIds.size > 0) {
      const friendArray = [...friendIds];

      const fofConnections = await this.db.friendship.findMany({
        where: {
          status: FriendshipStatus.ACCEPTED,
          OR: [
            { requesterId: { in: friendArray } },
            { receiverId: { in: friendArray } },
          ],
        },
        select: { requesterId: true, receiverId: true },
      });

      fofConnections.forEach((fc) => {
        const candidateId = friendIds.has(fc.requesterId)
          ? fc.receiverId
          : fc.requesterId;
        if (!excludedIds.has(candidateId)) {
          const existing = suggestions.get(candidateId);
          suggestions.set(candidateId, {
            score: (existing?.score ?? 0) + 1,
            reason: 'mutual_friends',
          });
        }
      });

      console.log(
        `[Suggestions] Tier1 mutual_friends candidates: ${suggestions.size}`,
      );
    }

    // ── Tier 2: Same location ──
    if (suggestions.size < FETCH_SIZE) {
      const { city, state, country } = currentUser?.profile ?? {};

      if (city || state || country) {
        const locationMatches = await this.db.user.findMany({
          where: {
            id: { notIn: excludedArray },
            isDisabled: { not: true },
            profile: {
              OR: [
                ...(city ? [{ city }] : []),
                ...(state ? [{ state }] : []),
                ...(country ? [{ country }] : []),
              ],
            },
          },
          select: {
            id: true,
            profile: { select: { city: true, state: true } },
          },
          take: FETCH_SIZE,
        });

        locationMatches.forEach(({ id, profile }) => {
          if (!suggestions.has(id)) {
            const score =
              profile?.city === city
                ? 0.9
                : profile?.state === state
                  ? 0.7
                  : 0.5;
            suggestions.set(id, { score, reason: 'same_location' });
          }
        });

        console.log(
          `[Suggestions] Tier2 same_location candidates: ${suggestions.size}`,
        );
      } else {
        console.log(`[Suggestions] Tier2 skipped — no location on profile`);
      }
    }

    // ── Tier 3: Popular users ──
    if (suggestions.size < FETCH_SIZE) {
      // Materialize full exclusion including current suggestion ids
      const excludedForTier3 = [...excludedIds, ...suggestions.keys()];

      const popular = await this.db.user.findMany({
        where: {
          id: { notIn: excludedForTier3 },
          isDisabled: { not: true },
        },
        select: {
          id: true,
          _count: {
            select: {
              receivedFriendRequests: {
                where: { status: FriendshipStatus.ACCEPTED },
              },
            },
          },
        },
        orderBy: { receivedFriendRequests: { _count: 'desc' } },
        take: FETCH_SIZE,
      });

      popular.forEach(({ id, _count }) => {
        if (!suggestions.has(id)) {
          suggestions.set(id, {
            score: Math.min(_count.receivedFriendRequests / 100, 0.4),
            reason: 'popular',
          });
        }
      });

      console.log(
        `[Suggestions] Tier3 popular candidates: ${suggestions.size}`,
      );
    }

    // ── Tier 4: Recently joined ──
    if (suggestions.size < FETCH_SIZE) {
      const excludedForTier4 = [...excludedIds, ...suggestions.keys()];

      const newUsers = await this.db.user.findMany({
        where: {
          id: { notIn: excludedForTier4 },
          isDisabled: { not: true },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        take: FETCH_SIZE,
      });

      newUsers.forEach(({ id }) => {
        if (!suggestions.has(id)) {
          suggestions.set(id, { score: 0.1, reason: 'new_user' });
        }
      });

      console.log(
        `[Suggestions] Tier4 new_users candidates: ${suggestions.size}`,
      );
    }

    const result = Array.from(suggestions.entries()).sort(
      (a, b) => b[1].score - a[1].score,
    );

    console.log(`[Suggestions] Final pool size: ${result.length}`);
    console.log({
      totalSuggestions: suggestions.size,
      mutualFriends: Array.from(suggestions.values()).filter(
        (s) => s.reason === 'mutual_friends',
      ).length,
      sameLocation: Array.from(suggestions.values()).filter(
        (s) => s.reason === 'same_location',
      ).length,
      popular: Array.from(suggestions.values()).filter(
        (s) => s.reason === 'popular',
      ).length,
      newUsers: Array.from(suggestions.values()).filter(
        (s) => s.reason === 'new_user',
      ).length,
    });

    console.log({
      totalUsers: await this.db.user.count(),
      enabledUsers: await this.db.user.count({
        where: {
          isDisabled: { not: true },
        },
      }),
      excludedUsers: excludedIds.size,
    });

    return result;
  }

  async getSentRequests(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      this.db.friendship.findMany({
        where: { requesterId: userId, status: FriendshipStatus.PENDING },
        include: {
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
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.friendship.count({
        where: { requesterId: userId, status: FriendshipStatus.PENDING },
      }),
    ]);

    return {
      data: requests.map((req) => ({
        id: req.id,
        receiver: req.receiver,
        requestedAt: req.createdAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private async cancelFriendRequest(userId: string, friendship: Friendship) {
    if (friendship.requesterId !== userId) {
      throw new ForbiddenException(
        'Only the requester can cancel a friend request',
      );
    }

    await this.db.friendship.delete({
      where: {
        id: friendship.id,
      },
    });

    await Promise.all([
      this.invalidateFriendRequestsCache(friendship.receiverId),

      this.invalidateStatusCache(userId, friendship.receiverId),
    ]);

    return {
      message: 'Friend request cancelled',
    };
  }

  async handleRequestAction(
    userId: string,
    requestId: string,
    action: FriendRequestAction,
  ) {
    const friendship = await this.db.friendship.findFirst({
      where: {
        id: requestId,
        status: FriendshipStatus.PENDING,
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    switch (action) {
      case FRIEND_REQUEST_ACTION.ACCEPT:
        if (friendship.receiverId !== userId) {
          throw new ForbiddenException();
        }

        return this.acceptFriendRequest(userId, friendship);

      case FRIEND_REQUEST_ACTION.DECLINE:
        if (friendship.receiverId !== userId) {
          throw new ForbiddenException();
        }

        return this.declineFriendRequest(userId, friendship);

      case FRIEND_REQUEST_ACTION.CANCEL:
        if (friendship.requesterId !== userId) {
          console.log({ userId, friendship });

          throw new ForbiddenException('not');
        }

        return this.cancelFriendRequest(userId, friendship);

      default:
        throw new BadRequestException('Invalid action');
    }
  }

  async getFriendIds(userId: string): Promise<string[]> {
    const friendships = await this.db.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      select: {
        requesterId: true,
        receiverId: true,
      },
    });

    return friendships.map((f) =>
      f.requesterId === userId ? f.receiverId : f.requesterId,
    );
  }

  async getOnlineFriends(userId: string, page = 1, limit = 20) {
    const friendIds = await this.getFriendIds(userId);

    if (!friendIds.length) {
      return {
        data: [],
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }

    const onlineUserIds = await this.presenceService.getOnlineUsers();

    // FAST SET intersection
    const onlineFriendIds = friendIds.filter((id) =>
      onlineUserIds.includes(id),
    );

    const total = onlineFriendIds.length;

    const paginatedIds = onlineFriendIds.slice(
      (page - 1) * limit,
      page * limit,
    );

    const users = await this.db.user.findMany({
      where: {
        id: { in: paginatedIds },
      },
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
      data: users.map((u) => ({
        ...u,
        isOnline: true,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async getRateLimitCount(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const record = await this.db.friendRequestRateLimit.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    return record?.requestCount ?? 0;
  }

  private async incrementRateLimit(userId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.db.friendRequestRateLimit.upsert({
      where: { userId_date: { userId, date: today } },
      update: { requestCount: { increment: 1 } },
      create: { userId, date: today, requestCount: 1 },
    });
  }

  private async invalidateUserFriendsCache(userId: string) {
    const keys = await this.redis.keys(
      `${this.FRIENDS_CACHE_PREFIX}${userId}:*`,
    );
    if (keys.length) await this.redis.del(...keys);
  }

  private async invalidateFriendRequestsCache(userId: string) {
    const keys = await this.redis.keys(
      `${this.FRIEND_REQUESTS_CACHE_PREFIX}${userId}:*`,
    );
    if (keys.length) await this.redis.del(...keys);
  }

  private async invalidateSuggestionsCache(userId: string) {
    const keys = await this.redis.keys(
      `${this.SUGGESTIONS_CACHE_PREFIX}${userId}:*`,
    );
    if (keys.length) await this.redis.del(...keys);
  }

  private async invalidateStatusCache(userId: string, targetUserId: string) {
    await Promise.all([
      this.redis.del(`${this.STATUS_CACHE_PREFIX}${userId}:${targetUserId}`),
      this.redis.del(`${this.STATUS_CACHE_PREFIX}${targetUserId}:${userId}`),
    ]);
  }
}
