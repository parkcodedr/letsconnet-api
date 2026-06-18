export const SocketNamespaces = {
  MEDIA: '/media',
  CHAT: '/chat',
  SIGNAL: '/signal',
  NOTIFICATIONS: '/notifications',
  POST: '/post',
  STORIES: '/stories',
  PRESENCE: '/presence',
} as const;

export const NotificationEvents = {
  MARK_READ: 'notification:read',
  MARK_ALL_READ: 'notification:read:all',

  CONNECTED: 'connected',
  NEW_NOTIFICATION: 'notification:new',
  UNREAD_COUNT: 'notification:count',
};

export const MediaEvents = {
  CONNECTED: 'connected',
  POST_READY: 'post:ready',
  POST_ERROR: 'post:error',
  MEDIA_PROCESSING: 'media:processing',
  MEDIA_READY: 'media:ready',
  MEDIA_ERROR: 'media:error',
  NOTIFICATION: 'notification',
} as const;

export const ChatEvents = {
  JOIN_CHAT: 'chat:join',
  LEAVE_CHAT: 'chat:leave',
  SEND_MESSAGE: 'chat:send',
  TYPING_START: 'chat:typing:start',
  TYPING_STOP: 'chat:typing:stop',
  MARK_READ: 'chat:read',

  CONNECTED: 'connected',
  NEW_MESSAGE: 'chat:message',
  TYPING: 'chat:typing',
  MESSAGE_READ: 'chat:message:read',
  USER_ONLINE: 'chat:user:online',
  USER_OFFLINE: 'chat:user:offline',
} as const;

export const SignalEvents = {
  CALL_OFFER: 'signal:offer',
  CALL_ANSWER: 'signal:answer',
  ICE_CANDIDATE: 'signal:ice',
  CALL_END: 'signal:end',

  // Server → client
  CONNECTED: 'connected',
  INCOMING_CALL: 'signal:incoming',
  CALL_ACCEPTED: 'signal:accepted',
  CALL_REJECTED: 'signal:rejected',
  CALL_ENDED: 'signal:ended',
  ICE_RELAY: 'signal:ice:relay',
} as const;

export const StoryEvents = {
  CONNECTED: 'connected',
  STORY_READY: 'story:ready',
  STORY_ERROR: 'story:error',
} as const;

export enum PresenceEvents {
  USER_ONLINE = 'presence:user_online',
  USER_OFFLINE = 'presence:user_offline',
  ONLINE_USERS = 'presence:online',
}
