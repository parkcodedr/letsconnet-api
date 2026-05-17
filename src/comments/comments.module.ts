import { Module } from '@nestjs/common';
import { RedisCacheModule } from 'src/cache/redis-cache.module';
import { CommentsController } from './comments.controller';
import { DatabaseService } from 'src/database/database.service';
import { CommentsService } from './comments.service';

@Module({
  imports: [RedisCacheModule],
  controllers: [CommentsController],
  providers: [CommentsService, DatabaseService],
  exports: [CommentsService],
})
export class CommentsModule {}
