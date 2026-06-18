import { Module } from '@nestjs/common';
import { FriendshipService } from './friendship.service';
import { FriendshipController } from './friendship.controller';
import { DatabaseService } from 'src/database/database.service';
import { RedisCacheModule } from 'src/cache/redis-cache.module';
import { PresenceService } from 'src/realtime/services/presence.service';

@Module({
  imports: [RedisCacheModule],
  controllers: [FriendshipController],
  providers: [FriendshipService, DatabaseService,PresenceService],
  exports: [FriendshipService],
})
export class FriendshipModule {}
