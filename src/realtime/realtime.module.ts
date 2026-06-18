// src/realtime/realtime.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { MediaGateway } from './gateways/media.gateway';
import { ChatGateway } from './gateways/chat.gateway';
import { SignalGateway } from './gateways/signal.gateway';
import { StoryGateway } from './gateways/story.gateway';
import { PresenceService } from './services/presence.service';
import { FriendshipModule } from 'src/friendship/friendship.module';

@Module({
  imports: [DatabaseModule,FriendshipModule],
  providers: [MediaGateway, ChatGateway, SignalGateway, StoryGateway,PresenceService],
  exports: [MediaGateway, ChatGateway, SignalGateway, StoryGateway,PresenceService],
})
export class RealtimeModule {}
