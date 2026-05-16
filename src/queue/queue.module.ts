import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
      },
    }),

    BullModule.registerQueue({
      name: 'media-processing',
    }),
  ],

  exports: [BullModule],
})
export class QueueModule {}