import { Module } from '@nestjs/common';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';
import { RedisCacheModule } from 'src/cache/redis-cache.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports:[RedisCacheModule,DatabaseModule],
  providers: [FeedService],
  controllers: [FeedController]
})
export class FeedModule {}
