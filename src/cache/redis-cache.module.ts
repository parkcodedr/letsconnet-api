import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CACHE = 'REDIS_CACHE';
export const REDIS_PUBSUB = 'REDIS_PUBSUB';
export const REDIS_PUBLISHER = 'REDIS_PUBLISHER';

const createRedisClient = (configService: ConfigService) => {
  const url = configService.get<string>('REDIS_URL');

  return new Redis(url ?? 'redis://localhost:6379', {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    tls: url?.startsWith('rediss://') ? {} : undefined,
  });
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