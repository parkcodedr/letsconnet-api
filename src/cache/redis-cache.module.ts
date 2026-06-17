import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CACHE = 'REDIS_CACHE';
export const REDIS_PUBSUB = 'REDIS_PUBSUB';
export const REDIS_PUBLISHER = 'REDIS_PUBLISHER';

const createRedisClient = (configService: ConfigService) => {
  const url = configService.get<string>('REDIS_URL');

  if (!url) {
    throw new Error('REDIS_URL is not defined in environment variables');
  }

  const client = new Redis(url, {
    retryStrategy: (times) => {
      if (times > 5) {
        // Stop retrying after 5 attempts
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    tls: url.startsWith('rediss://') ? {} : undefined,
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected to:', url.split('@').pop()); 
  });

  return client;
};
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService),
      inject: [ConfigService],
    },
    {
      provide: REDIS_PUBSUB,
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService),
      inject: [ConfigService],
    },
    {
      provide: REDIS_PUBLISHER,
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CACHE, REDIS_PUBSUB, REDIS_PUBLISHER],
})
export class RedisCacheModule {}
