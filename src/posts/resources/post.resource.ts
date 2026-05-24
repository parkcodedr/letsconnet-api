export interface PostResource {
  id: string;
  content: string | null;
  sharedCaption?: string | null;
  status: string;
  visibility: string;
  thumbnailUrl: string | null;
  media: MediaResource[];
  mediaCount: number;
  reactionsCount: number;
  commentsCount: number;
  sharesCount: number;
  createdAt: Date;
  updatedAt: Date;
  isShared: boolean;
  userReaction?: string | null;
  author: AuthorResource;
  originalPost?: OriginalPostResource | null;
}
export interface OriginalPostResource {
  id: string;
  content: string | null;
  author: AuthorResource;
  thumbnailUrl: string | null;
  reactionsCount: number;
  commentsCount: number;
  createdAt: Date;
}

export interface AuthorResource {
  id: string;
  email?: string;
  profile: {
    firstName: string;
    lastName: string;
    username: string;
    avatarUrl: string | null;
  };
}

export interface PostDetailResource {
  id: string;
  content: string | null;
  sharedCaption?: string | null;
  status: string;
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
  author: AuthorResource;
  media: MediaResource[];
  reactionCounts: Record<string, number>;
  currentUserReaction: string | null;
  commentsCount: number;
  sharesCount: number;
  isShared: boolean;
  originalPost?: OriginalPostDetailResource | null;
}

export interface MediaResource {
  id: string;
  url: string;
  type: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface OriginalPostDetailResource {
  id: string;
  content: string | null;
  author: AuthorResource;
  media: MediaResource[];
  reactionsCount: number;
  commentsCount: number;
  createdAt: Date;
}

export class PostResourceMapper {
  static toPostResource(
    post: any,
    userId?: string,
    originalPostData?: any,
  ): PostResource {
    const isShared = !!post.sharedPostId;

    return {
      id: post.id,
      content: post.content,
      sharedCaption: post.sharedCaption,
      status: post.status,
      visibility: post.visibility,
      thumbnailUrl: post.media?.[0]?.url || null,
      media:
        post.media?.map((m: any) => ({
          id: m.id,
          url: m.url,
          type: m.type,
          thumbnailUrl: m.thumbnailUrl,
          width: m.width,
          height: m.height,
        })) || [],
      mediaCount: post._count?.media || 0,
      reactionsCount: post._count?.reactions || 0,
      commentsCount: post._count?.comments || 0,
      sharesCount: post.sharesCount || 0,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      isShared,
      userReaction: post.reactions?.[0]?.type || null,
      author: this.toAuthorResource(post.author),
      originalPost: originalPostData
        ? this.toOriginalPostResource(originalPostData)
        : null,
    };
  }

  static toOriginalPostResource(post: any): OriginalPostResource {
    return {
      id: post.id,
      content: post.content,
      author: this.toAuthorResource(post.author),
      thumbnailUrl: post.media?.[0]?.url || null,
      reactionsCount: post._count?.reactions || 0,
      commentsCount: post._count?.comments || 0,
      createdAt: post.createdAt,
    };
  }

  static toPostDetailResource(
    post: any,
    reactionCounts: Record<string, number>,
    userId?: string,
    originalPostData?: any,
  ): PostDetailResource {
    const isShared = !!post.sharedPostId;

    return {
      id: post.id,
      content: post.content,
      sharedCaption: post.sharedCaption,
      status: post.status,
      visibility: post.visibility,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: this.toAuthorResource(post.author),
      media: this.toMediaResources(post.media || []),
      reactionCounts,
      currentUserReaction: post.reactions?.[0]?.type || null,
      commentsCount: post._count?.comments || 0,
      sharesCount: post.sharesCount || 0,
      isShared,
      originalPost: originalPostData
        ? this.toOriginalPostDetailResource(originalPostData)
        : null,
    };
  }

  static toOriginalPostDetailResource(post: any): OriginalPostDetailResource {
    return {
      id: post.id,
      content: post.content,
      author: this.toAuthorResource(post.author),
      media: this.toMediaResources(post.media || []),
      reactionsCount: post._count?.reactions || 0,
      commentsCount: post._count?.comments || 0,
      createdAt: post.createdAt,
    };
  }

  static toAuthorResource(author: any): AuthorResource {
    return {
      id: author.id,
      email: author.email,
      profile: {
        firstName: author.profile?.firstName || '',
        lastName: author.profile?.lastName || '',
        username: author.profile?.username || '',
        avatarUrl: author.profile?.avatarUrl || null,
      },
    };
  }

  static toMediaResources(mediaList: any[]): MediaResource[] {
    return mediaList.map((media) => ({
      id: media.id,
      url: media.url || '',
      type: media.type,
      thumbnailUrl: media.thumbnailUrl,
      width: media.width,
      height: media.height,
    }));
  }

  static toPostListResponse(posts: any[], userId?: string): PostResource[] {
    return posts.map((post) => this.toPostResource(post, userId));
  }
}
