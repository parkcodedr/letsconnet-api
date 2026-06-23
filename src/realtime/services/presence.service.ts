import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class PresenceService {
  private readonly ONLINE_USERS_KEY = 'presence:online_users';

  constructor(
    @Inject('REDIS_CACHE')
    private readonly redis: Redis,
  ) {}

  async setOnline(userId: string) {
    await this.redis.sadd(this.ONLINE_USERS_KEY, userId);
    return true;
  }

  async setOffline(userId: string) {
    await this.redis.srem(this.ONLINE_USERS_KEY, userId);
    return false;
  }

  async isOnline(userId: string) {
    return (await this.redis.sismember(this.ONLINE_USERS_KEY, userId)) === 1;
  }

  async getOnlineUsers(): Promise<string[]> {
    return this.redis.smembers(this.ONLINE_USERS_KEY);
  }
}
