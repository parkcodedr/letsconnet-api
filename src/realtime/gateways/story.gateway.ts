import { Logger } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { BaseGateway } from 'src/realtime/gateways/base.gateway';
import { SocketNamespaces, StoryEvents } from '../constant/socket-events';

@WebSocketGateway({ namespace: SocketNamespaces.STORIES })
export class StoryGateway extends BaseGateway {
  protected readonly logger = new Logger(
    StoryGateway.name,
  );

  emitStoryReady(
    userId: string,
    payload: Record<string, unknown>,
  ) {
   
    
    this.emitToUser(
      userId,
      StoryEvents.STORY_READY,
      payload,
    );
  }

  emitStoryFailed(
    userId: string,
    payload: Record<string, unknown>,
  ) {
    this.emitToUser(
      userId,
      StoryEvents.STORY_ERROR,
      payload,
    );
  }
}