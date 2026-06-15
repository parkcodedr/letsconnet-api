// src/realtime/gateways/notifications.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { AuthenticatedSocket } from '../adapters/socket-io.adapter';
import { BaseGateway } from './base.gateway';
import {
  NotificationEvents,
  SocketNamespaces,
} from '../constant/socket-events';
import { NotificationsService } from 'src/notifications/notifications.service';
import { DatabaseService } from 'src/database/database.service';

interface MarkReadDto {
  notificationId: string;
}

@WebSocketGateway({ namespace: SocketNamespaces.NOTIFICATIONS })
export class NotificationsGateway extends BaseGateway {
  protected readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    // forwardRef handles circular dependency with NotificationsService
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly db: DatabaseService,
  ) {
    super();
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const ok = this.onConnect(client);
    if (!ok) return;

    // Emit CONNECTED confirmation + current unread count in one go
    const [unreadCount] = await Promise.all([
      this.db.notification.count({
        where: { receiverId: client.user.sub, isRead: false },
      }),
    ]);

    client.emit(NotificationEvents.CONNECTED, { userId: client.user.sub });
    client.emit(NotificationEvents.UNREAD_COUNT, { count: unreadCount });
  }

  // ── Client → server ───────────────────────────────────────────────────────

  @SubscribeMessage(NotificationEvents.MARK_READ)
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { notificationId }: MarkReadDto,
  ): Promise<{ success: boolean }> {
    await this.notificationsService.markAsRead(
      client.user.sub,
      notificationId,
    );

    await this.pushUnreadCount(client.user.sub);

    return { success: true };
  }

  @SubscribeMessage(NotificationEvents.MARK_ALL_READ)
  async handleMarkAllRead(
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<{ success: boolean; count: number }> {
    const result = await this.notificationsService.markAllAsRead(
      client.user.sub,
    );

    await this.pushUnreadCount(client.user.sub);

    return { success: true, count: result.count };
  }

  // ── Server → client API (called by NotificationsService) ─────────────────

  /**
   * Push a new notification to a specific user.
   * Called from NotificationsService after persisting to the database.
   */
  sendNotification(userId: string, payload: Record<string, unknown>): void {
    this.emitToUser(userId, NotificationEvents.NEW_NOTIFICATION, payload);
  }

  /**
   * Recalculate and push the unread count to a user.
   * Call this after any operation that changes notification read state.
   */
  async updateUnreadCount(userId: string): Promise<void> {
    await this.pushUnreadCount(userId);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async pushUnreadCount(userId: string): Promise<void> {
    const count = await this.db.notification.count({
      where: { receiverId: userId, isRead: false },
    });

    this.emitToUser(userId, NotificationEvents.UNREAD_COUNT, { count });
  }
}