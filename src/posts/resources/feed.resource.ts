import { PostResource } from './post.resource';

export interface FeedResponse {
  data: FeedItemResource[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface FeedItemResource {
  id: string;
  type: 'post' | 'share';
  data: PostResource;
  createdAt: Date;
}

export class FeedResourceMapper {
  static toFeedResponse(
    items: any[],
    total: number,
    page: number,
    limit: number,
  ): FeedResponse {
    return {
      data: items.map((item) => ({
        id: item.id,
        type: item.type,
        data: item.data,
        createdAt: item.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }
}
