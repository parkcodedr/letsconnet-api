import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CACHE = 'REDIS_CACHE';
export const REDIS_PUBSUB = 'REDIS_PUBSUB';
export const REDIS_PUBLISHER = 'REDIS_PUBLISHER'; 

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      useFactory: (configService: ConfigService) => new Redis({
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: Number(configService.get<string>('REDIS_PORT', '6379')),
        password: configService.get<string>('REDIS_PASSWORD'),
        retryStrategy: (times) => Math.min(times * 50, 2000),
      }),
      inject: [ConfigService],
    },
    {
      provide: REDIS_PUBSUB,      // subscriber-only connection
      useFactory: (configService: ConfigService) => new Redis({
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: Number(configService.get<string>('REDIS_PORT', '6379')),
        password: configService.get<string>('REDIS_PASSWORD'),
        retryStrategy: (times) => Math.min(times * 50, 2000),
      }),
      inject: [ConfigService],
    },
    {
      provide: REDIS_PUBLISHER,   //  publisher-only connection
      useFactory: (configService: ConfigService) => new Redis({
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: Number(configService.get<string>('REDIS_PORT', '6379')),
        password: configService.get<string>('REDIS_PASSWORD'),
        retryStrategy: (times) => Math.min(times * 50, 2000),
      }),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CACHE, REDIS_PUBSUB, REDIS_PUBLISHER], 
})
export class RedisCacheModule {}