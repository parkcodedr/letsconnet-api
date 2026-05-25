import { Injectable, Inject, NotFoundException, forwardRef } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { Redis as RedisClient } from 'ioredis';
import { REDIS_CLIENT } from 'src/cache/redis-cache.module';
import { GetNotificationsDto } from './dto/notification.dto';
import { NotificationsGateway } from 'src/realtime/gateways/notifications.gateway';

interface FormattedNotification {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  sender: {
    id: string;
    profile: {
      firstName: string;
      lastName: string;
      username: string;
      avatarUrl: string | null;
    };
  } | null;
  actionUrl: string;
  actionData?: any;
  metadata?: any;
}

interface GroupedNotifications {
  today: FormattedNotification[];
  yesterday: FormattedNotification[];
  thisWeek: FormattedNotification[];
  earlier: FormattedNotification[];
}

@Injectable()
export class NotificationsService {
  private readonly CACHE_TTL = 60;

  constructor(
    private db: DatabaseService,
    @Inject(forwardRef(() => NotificationsGateway))
    private notificationsGateway: NotificationsGateway,
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisClient,
  ) {}

  async createNotification(data: {
    receiverId: string;
    type: string;
    senderId?: string;
    postId?: string;
    commentId?: string;
    entityId?: string;
    metadata?: any;
  }) {
    if (data.senderId === data.receiverId) {
      return null;
    }

    const existing = await this.db.notification.findFirst({
      where: {
        receiverId: data.receiverId,
        senderId: data.senderId,
        type: data.type as any,
        postId: data.postId,
        commentId: data.commentId,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
    });

    if (existing) {
      return this.db.notification.update({
        where: { id: existing.id },
        data: {
          createdAt: new Date(),
          metadata: data.metadata,
        },
        include: {
          sender: {
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
            select: { id: true, content: true },
          },
          comment: {
            select: { id: true, content: true },
          },
        },
      });
    }

    const notification = await this.db.notification.create({
      data: {
        receiverId: data.receiverId,
        type: data.type as any,
        senderId: data.senderId,
        postId: data.postId,
        commentId: data.commentId,
        entityId: data.entityId,
        metadata: data.metadata,
      },
      include: {
        sender: {
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
          select: { id: true, content: true },
        },
        comment: {
          select: { id: true, content: true },
        },
      },
    });

    this.notificationsGateway.sendToUser(data.receiverId, 'new_notification', {
      notification,
      unreadCount: await this.getUnreadCount(data.receiverId),
    });

    await this.notificationsGateway.updateUnreadCount(data.receiverId);
    await this.invalidateNotificationCache(data.receiverId);

    return notification;
  }

  async getUserNotifications(userId: string, query: GetNotificationsDto) {
    const { page = 1, limit = 20, unreadOnly = false } = query;
    const cacheKey = `notifications:${userId}:${page}:${limit}:${unreadOnly}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const skip = (page - 1) * limit;
    const where = {
      receiverId: userId,
      ...(unreadOnly && { isRead: false }),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.db.notification.findMany({
        where,
        include: {
          sender: {
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
            select: { id: true, content: true },
          },
          comment: {
            select: { id: true, content: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.notification.count({ where }),
      this.db.notification.count({
        where: { receiverId: userId, isRead: false },
      }),
    ]);

    const grouped = this.groupNotificationsByDate(notifications);

    const result = {
      data: grouped,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        unreadCount,
      },
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    return result;
  }

  private groupNotificationsByDate(notifications: any[]): GroupedNotifications {
    const groups: GroupedNotifications = {
      today: [],
      yesterday: [],
      thisWeek: [],
      earlier: [],
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    notifications.forEach((notification) => {
      const date = new Date(notification.createdAt);
      const formatted = this.formatNotification(notification);

      if (date >= today) {
        groups.today.push(formatted);
      } else if (date >= yesterday) {
        groups.yesterday.push(formatted);
      } else if (date >= thisWeek) {
        groups.thisWeek.push(formatted);
      } else {
        groups.earlier.push(formatted);
      }
    });

    return groups;
  }

  private formatNotification(notification: any): FormattedNotification {
    let message = '';
    const actionData: any = {
      type: notification.type,
      notificationId: notification.id,
    };

    switch (notification.type) {
      case 'FRIEND_REQUEST':
        message = `sent you a friend request`;
        actionData.senderId = notification.sender?.id;
        actionData.type = 'friend_request';
        break;
      case 'FRIEND_ACCEPTED':
        message = `accepted your friend request`;
        actionData.friendId = notification.sender?.id;
        actionData.type = 'friend';
        break;
      case 'POST_LIKE':
        message = `liked your post`;
        actionData.postId = notification.postId;
        actionData.type = 'post';
        actionData.interaction = 'like';
        break;
      case 'POST_COMMENT':
        message = `commented on your post`;
        actionData.postId = notification.postId;
        actionData.commentId = notification.commentId;
        actionData.type = 'post';
        actionData.interaction = 'comment';
        actionData.preview = notification.comment?.content?.substring(0, 100);
        break;
      case 'POST_SHARE':
        message = `shared your post`;
        actionData.postId = notification.postId;
        actionData.type = 'post';
        actionData.interaction = 'share';
        break;
      case 'COMMENT_LIKE':
        message = `liked your comment`;
        actionData.postId = notification.postId;
        actionData.commentId = notification.commentId;
        actionData.type = 'comment';
        actionData.interaction = 'like';
        break;
      case 'COMMENT_REPLY':
        message = `replied to your comment`;
        actionData.postId = notification.postId;
        actionData.commentId = notification.commentId;
        actionData.type = 'comment';
        actionData.interaction = 'reply';
        actionData.preview = notification.comment?.content?.substring(0, 100);
        break;
      case 'MEDIA_LIKE':
        message = `liked your media`;
        actionData.postId = notification.postId;
        actionData.mediaId = notification.metadata?.mediaId;
        actionData.type = 'media';
        actionData.interaction = 'like';
        break;
      case 'MEDIA_COMMENT':
        message = `commented on your media`;
        actionData.postId = notification.postId;
        actionData.mediaId = notification.metadata?.mediaId;
        actionData.commentId = notification.commentId;
        actionData.type = 'media';
        actionData.interaction = 'comment';
        break;
      default:
        message = `interacted with your content`;
        actionData.type = 'generic';
    }

    return {
      id: notification.id,
      type: notification.type,
      message,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      sender: notification.sender,
      actionUrl: '',
      actionData,
      metadata: notification.metadata,
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.db.notification.findFirst({
      where: { id: notificationId, receiverId: userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.db.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    await this.invalidateNotificationCache(userId);
    await this.notificationsGateway.updateUnreadCount(userId);

    return { success: true };
  }

  async markAllAsRead(userId: string, type?: string) {
    const where: any = { receiverId: userId, isRead: false };
    if (type) {
      where.type = type;
    }

    const result = await this.db.notification.updateMany({
      where,
      data: { isRead: true },
    });

    await this.invalidateNotificationCache(userId);
    await this.notificationsGateway.updateUnreadCount(userId);

    return { count: result.count };
  }

  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.db.notification.findFirst({
      where: { id: notificationId, receiverId: userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.db.notification.delete({ where: { id: notificationId } });

    await this.invalidateNotificationCache(userId);
    await this.notificationsGateway.updateUnreadCount(userId);

    return { success: true };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const cacheKey = `notifications:unread:${userId}`;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return parseInt(cached, 10);
    }

    const count = await this.db.notification.count({
      where: { receiverId: userId, isRead: false },
    });

    await this.redis.setex(cacheKey, 30, count.toString());
    return count;
  }

  async cleanupOldNotifications(daysOld: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.db.notification.deleteMany({
      where: {
        isRead: true,
        createdAt: { lt: cutoffDate },
      },
    });

    console.log(`Cleaned up ${result.count} old notifications`);
    return result;
  }

  private async invalidateNotificationCache(userId: string) {
    const keys = await this.redis.keys(`notifications:${userId}:*`);
    if (keys.length) {
      await this.redis.del(...keys);
    }
    await this.redis.del(`notifications:unread:${userId}`);
  }
}
