import { Module } from '@nestjs/common';
import { EventListenerService } from './event-listener.service';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { RedisCacheModule } from 'src/cache/redis-cache.module';
import { PresenceGateway } from 'src/realtime/gateways/presence.gateway';
import { FriendshipModule } from 'src/friendship/friendship.module';
import { EventBusModule } from './event-bus.module';

@Module({
  imports: [RealtimeModule, RedisCacheModule,FriendshipModule,EventBusModule],
  providers: [EventListenerService,PresenceGateway],
})
export class EventListenerModule {}
