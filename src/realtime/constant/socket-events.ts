export const SocketEvents = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',

  JOIN_POST: 'join-post',
  LEAVE_POST: 'leave-post',

  MEDIA_PROCESSING: 'media-processing',
  MEDIA_READY: 'media-ready',
  MEDIA_FAILED: 'media-failed',
  MEDIA_ERROR: 'media-error',

  NEW_NOTIFICATION: 'new_notification',
  NOTIFICATION_COUNT: 'notification_count',
  MARK_NOTIFICATION_READ: 'mark_notification_read',
  MARK_ALL_NOTIFICATIONS_READ: 'mark_all_notifications_read',

  MESSAGE: 'message',
  TYPING: 'typing',
  READ: 'read',

  PRESENCE: 'presence',
} as const;
