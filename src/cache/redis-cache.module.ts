import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CACHE = 'REDIS_CACHE';
export const REDIS_PUBSUB = 'REDIS_PUBSUB';
export const REDIS_PUBLISHER = 'REDIS_PUBLISHER';

const createRedisClient = (url: string, label: string) => {
  const isTLS = url.startsWith('rediss://');

  const client = new Redis(url, {
    retryStrategy: (times) => {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    ...(isTLS && { tls: { rejectUnauthorized: false } }),
  });

  client.on('error', (err) =>
    console.error(`[Redis:${label}] Error:`, err.message),
  );
  client.on('connect', () => console.log(`[Redis:${label}] Connected`));
  client.on('ready', () => console.log(`[Redis:${label}] Ready`));

  return client;
};

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        if (!url) throw new Error('REDIS_URL is not defined');
        return createRedisClient(url, 'cache');
      },
      inject: [ConfigService],
    },
    {
      provide: REDIS_PUBSUB,
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        if (!url) throw new Error('REDIS_URL is not defined');
        return createRedisClient(url, 'subscriber');
      },
      inject: [ConfigService],
    },
    {
      provide: REDIS_PUBLISHER,
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        if (!url) throw new Error('REDIS_URL is not defined');
        return createRedisClient(url, 'publisher');
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CACHE, REDIS_PUBSUB, REDIS_PUBLISHER],
})
export class RedisCacheModule {}
