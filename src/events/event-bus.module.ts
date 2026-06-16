import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { RedisCacheModule } from 'src/cache/redis-cache.module';

@Global()
@Module({
  imports: [RedisCacheModule],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventBusModule {}
