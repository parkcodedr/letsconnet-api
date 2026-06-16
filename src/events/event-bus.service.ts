import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_PUBLISHER } from 'src/cache/redis-cache.module'; 

@Injectable()
export class EventBusService {
  constructor(
    @Inject(REDIS_PUBLISHER)
    private readonly redis: Redis,
  ) {}

  async publish(channel: string, payload: unknown) {
    await this.redis.publish(channel, JSON.stringify(payload));
  }
}