
import { WebSocketGateway } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { AuthenticatedSocket } from '../adapters/socket-io.adapter';
import { BaseGateway } from './base.gateway';
import { MediaEvents, SocketNamespaces } from '../constant/socket-events';

@WebSocketGateway({ namespace: SocketNamespaces.MEDIA })
export class MediaGateway extends BaseGateway {
  protected readonly logger = new Logger(MediaGateway.name);

  handleConnection(client: AuthenticatedSocket): void {
    const ok = this.onConnect(client);
    if (!ok) return;

    client.emit(MediaEvents.CONNECTED, { userId: client.user.sub });
  }

  emitMediaReady(userId: string, payload: Record<string, unknown>): void {
    this.logger.log(`MEDIA_READY → user(${userId})`);
    this.emitToUser(userId, MediaEvents.MEDIA_READY, payload);
  }

  emitMediaProcessing(userId: string, payload: Record<string, unknown>): void {
    this.emitToUser(userId, MediaEvents.MEDIA_PROCESSING, payload);
  }

  emitMediaError(userId: string, payload: Record<string, unknown>): void {
    this.logger.warn(`MEDIA_ERROR → user(${userId})`);
    this.emitToUser(userId, MediaEvents.MEDIA_ERROR, payload);
  }

  emitPostReady(userId: string, payload: any) {
    this.server.to(userId).emit(MediaEvents.POST_READY, payload);
  }

  emitPostError(userId: string, payload: any) {
    this.server.to(userId).emit(MediaEvents.POST_ERROR, payload);
  }

  emitNotification(userId: string, payload: Record<string, unknown>): void {
    this.emitToUser(userId, MediaEvents.NOTIFICATION, payload);
  }
}
