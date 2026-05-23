import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { MediaProcessor } from 'src/posts/processors/media.processor';
import { DatabaseModule } from 'src/database/database.module';
import { StorageModule } from 'src/storage/storage.module';

import { MediaService } from './media.service';
import { MediaController } from './media.controller';

import { MediaGateway } from 'src/realtime/gateways/media.gateway';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'media-processing',
    }),

    DatabaseModule,
    StorageModule,
  ],

  controllers: [MediaController],

  providers: [MediaService, MediaProcessor, MediaGateway],

  exports: [MediaService, BullModule],
})
export class MediaModule {}
