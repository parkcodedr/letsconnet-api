import { Prisma } from 'generated/prisma/client';

export type PostWithRelations = Prisma.PostGetPayload<{
  include: {
    media: true;

    author: {
      select: {
        id: true;
        email: true;

        profile: {
          select: {
            firstName: true;
            lastName: true;
            avatarUrl: true;
            username: true;
          };
        };
      };
    };

    reactions: {
      select: {
        type: true;
      };
    };

    _count: {
      select: {
        comments: true;
      };
    };
  };
}>;


export type ReactionType =
  | 'LIKE'
  | 'LOVE'
  | 'HAHA'
  | 'WOW'
  | 'SAD'
  | 'ANGRY';

export type FriendshipStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'BLOCKED';

export type NotificationType =
  | 'FRIEND_REQUEST'
  | 'FRIEND_ACCEPTED'
  | 'POST_LIKE'
  | 'POST_COMMENT'
  | 'POST_SHARE'
  | 'POST_MENTION'
  | 'POST_TAG'
  | 'COMMENT_LIKE'
  | 'COMMENT_REPLY'
  | 'COMMENT_MENTION'
  | 'MEDIA_LIKE'
  | 'MEDIA_COMMENT'
  | 'MESSAGE';

export type MediaType =
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO';

export type Visibility =
  | 'PUBLIC'
  | 'FRIENDS'
  | 'PRIVATE';

export type MessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'SYSTEM';

export type UserRole =
  | 'USER'
  | 'ADMIN'
  | 'MODERATOR';

export type Gender =
  | 'MALE'
  | 'FEMALE'
  | 'OTHER';

export type AuthProvider =
  | 'EMAIL'
  | 'GOOGLE'
  | 'APPLE';

export type PostStatus =
  | 'PROCESSING'
  | 'READY'
  | 'FAILED';

export type MediaProcessingStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED';