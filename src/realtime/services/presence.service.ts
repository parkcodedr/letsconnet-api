import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class PresenceService {
  private readonly ONLINE_USERS_KEY = 'online_users';

  constructor(
    @Inject('REDIS_CACHE')
    private readonly redis: Redis,
  ) {}

  async setOnline(userId: string) {
    const count = await this.redis.incr(`presence:user:${userId}`);

    return count;
  }

  async setOffline(userId: string) {
    const key = `presence:user:${userId}`;

    const count = await this.redis.decr(key);

    if (count <= 0) {
      await this.redis.del(key);

      return false;
    }

    return true;
  }

  async isOnline(userId: string) {
    const count = await this.redis.get(`presence:user:${userId}`);

    return Number(count) > 0;
  }

  async getOnlineUsers() {
    return this.redis.smembers(this.ONLINE_USERS_KEY);
  }
}
