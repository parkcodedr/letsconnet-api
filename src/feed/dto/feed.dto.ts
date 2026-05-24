import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class GetFeedDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: 'recent' | 'popular' = 'recent';
}

export interface FeedResponseDto {
  data: FeedItemDto[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

export interface FeedItemDto {
  id: string;
  type: 'post' | 'share';
  content: string | null;
  sharedCaption?: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    profile: {
      firstName: string;
      lastName: string;
      username: string;
      avatarUrl: string | null;
    };
  };
  media: {
    id: string;
    url: string;
    type: string;
    thumbnailUrl?: string | null;
  }[];
  reactionCounts: {
    total: number;
    userReaction: string | null;
    reactions: Array<{ type: string; count: number }>;
  };
  commentCount: number;
  shareCount: number;
  isShared: boolean;
  originalPost?: {
    id: string;
    content: string | null;
    author: {
      profile: {
        firstName: string;
        lastName: string;
        username: string;
        avatarUrl: string | null;
      };
    };
    media: {
      url: string;
      type: string;
      thumbnailUrl?: string | null;
    }[];
  } | null;
}
