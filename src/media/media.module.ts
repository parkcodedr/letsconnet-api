import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaProcessor } from 'src/posts/processors/media.processor';


@Module({
  imports: [
    BullModule.registerQueue({
      name: 'media-processing',
    }),
  ],
  providers: [MediaProcessor],
  exports: [BullModule],
})
export class MediaModule {}