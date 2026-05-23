import { Prisma } from 'generated/prisma/client';

// types/post.types.ts
export interface PostWithRelations {
  id: string;
  content: string | null;
  sharedCaption: string | null;
  sharedPostId: string | null;
  status: string;
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
  sharesCount: number;
  author: {
    id: string;
    email: string;
    profile: {
      firstName: string;
      lastName: string;
      username: string;
      avatarUrl: string | null;
    } | null;
  };
  media: Array<{
    id: string;
    url: string | null;
    type: string;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
  }>;
  reactions: Array<{ type: string }>;
  _count: {
    comments: number;
    reactions: number;
  };
}

export interface OriginalPostWithRelations {
  id: string;
  content: string | null;
  author: {
    id: string;
    email: string;
    profile: {
      firstName: string;
      lastName: string;
      username: string;
      avatarUrl: string | null;
    } | null;
  };
  media: Array<{
    id: string;
    url: string | null;
    type: string;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
  }>;
  _count: {
    comments: number;
    reactions: number;
  };
}

export type ReactionType = 'LIKE' | 'LOVE' | 'HAHA' | 'WOW' | 'SAD' | 'ANGRY';

export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'BLOCKED';

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

export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO';

export type Visibility = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';

export type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'SYSTEM';

export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export type AuthProvider = 'EMAIL' | 'GOOGLE' | 'APPLE';

export type PostStatus = 'PROCESSING' | 'READY' | 'FAILED';

export type MediaProcessingStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED';
