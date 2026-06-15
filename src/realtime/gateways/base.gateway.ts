
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

  private readonly seen = new Set<string>();

  afterInit(_server: Server): void {
    this.logger.log(`${this.constructor.name} initialised`);
  }

  
  handleConnection(client: AuthenticatedSocket): void {
    this.onConnect(client);
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.seen.delete(client.id);
    this.logger.log(
      `[${this.constructor.name}] ${client.id} disconnected` +
        ` (user: ${client.user?.sub ?? 'unknown'})`,
    );
  }

  
  protected onConnect(client: AuthenticatedSocket): boolean {
    if (this.seen.has(client.id)) {
      this.logger.debug(`Duplicate connection ignored: ${client.id}`);
      return false;
    }

    const userId = client.user?.sub;

    if (!userId) {
      this.logger.warn(`Unauthenticated socket ${client.id} — disconnecting`);
      client.disconnect(true);
      return false;
    }

    this.seen.add(client.id);
    client.join(userId);

    this.logger.log(
      `[${this.constructor.name}] ${client.id} connected → room(${userId})`,
    );

    return true;
  }

  protected emitToUser(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.server.to(userId).emit(event, payload);
  }

  protected emitToRoom(
    room: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.server.to(room).emit(event, payload);
  }
}