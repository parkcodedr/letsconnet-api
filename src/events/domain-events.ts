import { MediaEvents, StoryEvents } from 'src/realtime/constant/socket-events';

export const DomainEvents = {
  POST_READY: MediaEvents.POST_READY,
  POST_ERROR: MediaEvents.POST_ERROR,
  MEDIA_READY: MediaEvents.MEDIA_READY,
  MEDIA_ERROR: MediaEvents.MEDIA_ERROR,
  MEDIA_PROCESSING: MediaEvents.MEDIA_PROCESSING,

  
  STORY_READY: StoryEvents.STORY_READY,
  STORY_ERROR: StoryEvents.STORY_ERROR,
} as const;
