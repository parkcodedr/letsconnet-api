

export const SocketEvents = {
  CONNECT: 'connect',

  JOIN_POST: 'join-post',
  LEAVE_POST: 'leave-post',

  MEDIA_PROCESSING: 'media-processing',
  MEDIA_READY: 'media-ready',
  MEDIA_FAILED: 'media-failed',

  MESSAGE: 'message',
  TYPING: 'typing',
  READ: 'read',

  PRESENCE: 'presence',
} as const;
