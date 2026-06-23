import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaProcessor } from 'src/posts/processors/media.processor';
import { DatabaseModule } from 'src/database/database.module';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { StorageModule } from 'src/common/storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'media-processing' }),
    DatabaseModule,
    StorageModule,
    RealtimeModule,
  ],
  controllers: [MediaController],
  providers: [MediaService, MediaProcessor],
  exports: [MediaService, BullModule],
})
export class MediaModule {}
