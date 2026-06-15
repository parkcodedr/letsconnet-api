// src/realtime/realtime.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { MediaGateway } from './gateways/media.gateway';
import { ChatGateway } from './gateways/chat.gateway';
import { SignalGateway } from './gateways/signal.gateway';
import { StoryGateway } from './gateways/story.gateway';

@Module({
  imports: [DatabaseModule],
  providers: [MediaGateway, ChatGateway, SignalGateway, StoryGateway],
  exports: [MediaGateway, ChatGateway, SignalGateway, StoryGateway],
})
export class RealtimeModule {}
