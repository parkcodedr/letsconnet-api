import { Module } from '@nestjs/common';
import { EventListenerService } from './event-listener.service';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { RedisCacheModule } from 'src/cache/redis-cache.module';

@Module({
  imports: [RealtimeModule, RedisCacheModule],
  providers: [EventListenerService],
})
export class EventListenerModule {}
