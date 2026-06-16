import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Inject } from '@nestjs/common';

import { MediaGateway } from 'src/realtime/gateways/media.gateway';
import { StoryGateway } from 'src/realtime/gateways/story.gateway';

@Injectable()
export class EventListenerService implements OnModuleInit {
  constructor(
    @Inject('REDIS_PUBSUB')
    private readonly redis: Redis,

    private readonly mediaGateway: MediaGateway,
    private readonly storyGateway: StoryGateway,
  ) {}

  onModuleInit() {
    this.redis.subscribe(
      'post:ready',
      'post:error',
      'story:ready',
      'story:error',
    );

    this.redis.on('message', (channel, message) => {
      const payload = JSON.parse(message);

      switch (channel) {
        case 'post:ready':
          this.mediaGateway.emitPostReady(payload.userId, payload);
          break;

        case 'post:error':
          this.mediaGateway.emitPostError(payload.userId, payload);
          break;

        case 'story:ready':
          this.storyGateway.emitStoryReady(payload.userId, payload);
          break;

        case 'story:error':
          this.storyGateway.emitStoryFailed(payload.userId, payload);
          break;
      }
    });
  }
}