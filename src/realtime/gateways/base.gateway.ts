import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';

import { AuthenticatedSocket } from '../adapters/socket-io.adapter';

export abstract class BaseGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  protected readonly server!: Server;
  protected abstract readonly logger: Logger;
  protected readonly seen = new Set<string>();

  afterInit(): void {
    this.logger.log(`${this.constructor.name} initialized`);
  }

  handleConnection(client: AuthenticatedSocket): void {
    const ok = this.onConnect(client);
    if (!ok) return;

    void this.afterConnected(client);
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    this.seen.delete(client.id);

    await this.afterDisconnected(client);
  }

  protected onConnect(client: AuthenticatedSocket): boolean {
    if (this.seen.has(client.id)) return false;

    const userId = client.user?.sub;

    if (!userId) {
      client.disconnect(true);
      return false;
    }

    this.seen.add(client.id);
    client.join(userId);

    return true;
  }

  protected async afterConnected(_client: AuthenticatedSocket): Promise<void> {}

  protected async afterDisconnected(
    _client: AuthenticatedSocket,
  ): Promise<void> {}

  protected emitToUser(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ) {
    this.server.to(userId).emit(event, payload);
  }

  protected emitToUsers(
    userIds: string[],
    event: string,
    payload: Record<string, unknown>,
  ) {
    if (!userIds.length) return;
    this.server.to(userIds).emit(event, payload);
  }

  protected emitToRoom(
    room: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.server.to(room).emit(event, payload);
  }
}
