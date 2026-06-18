import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { RedisCacheModule } from 'src/cache/redis-cache.module';
import { PresenceGateway } from 'src/realtime/gateways/presence.gateway';
import { PresenceService } from 'src/realtime/services/presence.service';
import { FriendshipModule } from 'src/friendship/friendship.module';

@Global()
@Module({
  imports: [RedisCacheModule,FriendshipModule],
  providers: [EventBusService, PresenceGateway,PresenceService],
  exports: [EventBusService],
})
export class EventBusModule {}
