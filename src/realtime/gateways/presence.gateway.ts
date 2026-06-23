import { Logger } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';

import { BaseGateway } from './base.gateway';

import { PresenceEvents, SocketNamespaces } from '../constant/socket-events';

import { PresenceService } from '../services/presence.service';
import { EventBusService } from 'src/events/event-bus.service';
import { FriendshipService } from 'src/friendship/friendship.service';
import { AuthenticatedSocket } from '../adapters/socket-io.adapter';

@WebSocketGateway({ namespace: SocketNamespaces.PRESENCE })
export class PresenceGateway extends BaseGateway {
  protected readonly logger = new Logger(PresenceGateway.name);

  constructor(
    private readonly presenceService: PresenceService,
    private readonly eventBus: EventBusService,
    private readonly friendshipService: FriendshipService,
  ) {
    super();
  }

  protected override async afterConnected(client: AuthenticatedSocket) {
    const userId = client.user.sub;

    await this.presenceService.setOnline(userId);

    const friendIds = await this.friendshipService.getFriendIds(userId);

    // notify only friends
    this.emitToUsers(friendIds, 'user:online', { userId });
  }

  protected override async afterDisconnected(client: AuthenticatedSocket) {
    const userId = client.user?.sub;
    if (!userId) return;

    const stillOnline = await this.presenceService.setOffline(userId);

    if (!stillOnline) {
      const friendIds = await this.friendshipService.getFriendIds(userId);

      this.emitToUsers(friendIds, 'user:offline', { userId });
    }
  }

  async emitUserOnline(userId: string) {
    const friendIds = await this.friendshipService.getFriendIds(userId);

    this.emitToUsers(friendIds, 'user:online', { userId });
  }

  async emitUserOffline(userId: string) {
    const friendIds = await this.friendshipService.getFriendIds(userId);

    this.emitToUsers(friendIds, 'user:offline', { userId });
  }
}
