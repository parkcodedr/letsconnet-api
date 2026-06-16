import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
      },
    }),

    BullModule.registerQueue(
      { name: 'media-processing' },
      { name: 'process-story-media' },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}