import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const url = process.env.REDIS_URL;

        if (!url) {
          throw new Error('REDIS_URL is not defined in environment variables');
        }

        return {
          connection: { url },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        };
      },
    }),
    BullModule.registerQueue(
      {
        name: 'media-processing',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      },
      { name: 'process-story-media' },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
