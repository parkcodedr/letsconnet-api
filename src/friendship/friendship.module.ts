import { Module } from '@nestjs/common';
import { FriendshipService } from './friendship.service';
import { FriendshipController } from './friendship.controller';
import { DatabaseService } from 'src/database/database.service';
import { RedisCacheModule } from 'src/cache/redis-cache.module';

@Module({
  imports: [RedisCacheModule],
  controllers: [FriendshipController],
  providers: [FriendshipService, DatabaseService],
  exports: [FriendshipService],
})
export class FriendshipModule {}
