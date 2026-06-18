import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatMediaProcessor } from './chat-media.processor';
import { DatabaseService } from 'src/database/database.service';
import { RedisCacheModule } from 'src/cache/redis-cache.module';
import { AuthModule } from 'src/auth/auth.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { MediaGateway } from 'src/realtime/gateways/media.gateway';
import { ChatGateway } from 'src/realtime/gateways/chat.gateway';
import { PresenceService } from 'src/realtime/services/presence.service';
import { FriendshipModule } from 'src/friendship/friendship.module';

@Module({
  imports: [
    RedisCacheModule,
    AuthModule,
    StorageModule,
    BullModule.registerQueue({ name: 'chat-media-processing' }),
    FriendshipModule
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    ChatMediaProcessor,
    DatabaseService,
    MediaGateway,
    PresenceService
  ],
  exports: [ChatService],
})
export class ChatModule {}