import { Module } from '@nestjs/common';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';
import { DatabaseModule } from 'src/database/database.module';
import { StorageModule } from 'src/storage/storage.module';
import { BullModule } from '@nestjs/bullmq';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { StoryMediaProcessor } from './processor/story-media.processor';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    BullModule.registerQueue({ name: 'process-story-media' }),
    RealtimeModule,
  ],
  providers: [StoriesService, StoryMediaProcessor],
  controllers: [StoriesController],
})
export class StoriesModule {}
