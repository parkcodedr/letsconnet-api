import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { forwardRef, Inject, UseGuards } from '@nestjs/common';
import { AuthenticatedSocket } from 'src/realtime/type/auth';
import { SocketEvents } from 'src/realtime/constant/socket-events';
import { DatabaseService } from 'src/database/database.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { WsJwtGuard } from 'src/auth/guards/ws-jwt.guard';

@WebSocketGateway({
  cors: true,
  namespace: 'notifications',
})
@UseGuards(WsJwtGuard)
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private userSockets = new Map<string, Set<string>>();
  private socketUserMap = new Map<string, string>();

  constructor(
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
    private db: DatabaseService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (!userId) {
      client.disconnect();
      return;
    }

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);
    this.socketUserMap.set(client.id, userId);

    console.log(`🔌 Notification socket connected: ${userId} (${client.id})`);

    const unreadCount = await this.db.notification.count({
      where: { receiverId: userId, isRead: false },
    });
    client.emit(SocketEvents.NOTIFICATION_COUNT, { count: unreadCount });

    client.join(`user:${userId}`);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = this.socketUserMap.get(client.id);
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId)!.delete(client.id);
      if (this.userSockets.get(userId)!.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    this.socketUserMap.delete(client.id);
    console.log(
      `🔌 Notification socket disconnected: ${userId} (${client.id})`,
    );
  }

  @SubscribeMessage(SocketEvents.MARK_NOTIFICATION_READ)
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { notificationId: string },
  ) {
    const userId = client.data.userId;
    await this.notificationsService.markAsRead(userId, data.notificationId);

    const unreadCount = await this.db.notification.count({
      where: { receiverId: userId, isRead: false },
    });
    client.emit(SocketEvents.NOTIFICATION_COUNT, { count: unreadCount });

    return { success: true };
  }

  @SubscribeMessage(SocketEvents.MARK_ALL_NOTIFICATIONS_READ)
  async handleMarkAllRead(@ConnectedSocket() client: AuthenticatedSocket) {
    const userId = client.data.userId;
    const result = await this.notificationsService.markAllAsRead(userId);

    const unreadCount = await this.db.notification.count({
      where: { receiverId: userId, isRead: false },
    });
    client.emit(SocketEvents.NOTIFICATION_COUNT, { count: unreadCount });

    return { success: true, count: result.count };
  }

  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  sendToUsers(userIds: string[], event: string, data: any) {
    userIds.forEach((userId) => {
      this.server.to(`user:${userId}`).emit(event, data);
    });
  }

  async updateUnreadCount(userId: string) {
    const count = await this.db.notification.count({
      where: { receiverId: userId, isRead: false },
    });
    this.sendToUser(userId, SocketEvents.NOTIFICATION_COUNT, { count });
  }
}
