export interface ShareResponse {
  message: string;
  post: SharedPostResource;
}

export interface SharedPostResource {
  id: string;
  author: ShareAuthorResource;
  sharedCaption: string | null;
  createdAt: Date;
  isShared: true;
  originalPost: OriginalPostShareResource;
}

export interface ShareAuthorResource {
  id: string;
  profile: {
    firstName: string;
    lastName: string;
    username: string;
    avatarUrl: string | null;
  };
}

export interface OriginalPostShareResource {
  id: string;
  content: string | null;
  author: ShareAuthorResource;
  thumbnailUrl: string | null;
}

export class ShareResourceMapper {
  static toShareResponse(sharedPost: any, originalPost: any): ShareResponse {
    return {
      message: 'Post shared successfully',
      post: {
        id: sharedPost.id,
        author: {
          id: sharedPost.author.id,
          profile: {
            firstName: sharedPost.author.profile?.firstName || '',
            lastName: sharedPost.author.profile?.lastName || '',
            username: sharedPost.author.profile?.username || '',
            avatarUrl: sharedPost.author.profile?.avatarUrl || null,
          },
        },
        sharedCaption: sharedPost.sharedCaption,
        createdAt: sharedPost.createdAt,
        isShared: true,
        originalPost: {
          id: originalPost.id,
          content: originalPost.content,
          author: {
            id: originalPost.author.id,
            profile: {
              firstName: originalPost.author.profile?.firstName || '',
              lastName: originalPost.author.profile?.lastName || '',
              username: originalPost.author.profile?.username || '',
              avatarUrl: originalPost.author.profile?.avatarUrl || null,
            },
          },
          thumbnailUrl: originalPost.media?.[0]?.url || null,
        },
      },
    };
  }
}
