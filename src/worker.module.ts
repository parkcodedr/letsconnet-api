import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { RedisCacheModule } from './cache/redis-cache.module';


import { StoryMediaProcessor } from './stories/processor/story-media.processor';

import { EventBusModule } from './events/event-bus.module';
import { MediaProcessor } from './posts/processors/media.processor';
import { StorageModule } from './common/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    DatabaseModule,
    QueueModule,
    RedisCacheModule,
    StorageModule,
    EventBusModule,
  ],
  providers: [
    MediaProcessor,
    StoryMediaProcessor,
  ],
})
export class WorkerModule {}