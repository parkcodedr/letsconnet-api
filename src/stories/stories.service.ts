import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from 'src/database/database.service';
import { ReactionType } from 'src/posts/types';
import { CreateStoryOptions } from './dto/create-story.dto';

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: DatabaseService,
    @InjectQueue('process-story-media')
    private readonly storyQueue: Queue,
  ) {}

  private async getActiveStory(storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: {
        id: storyId,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        media: true,
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return story;
  }

  async createStory(
    userId: string,
    options: CreateStoryOptions,
    files: Express.Multer.File[],
  ) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    console.log({ options });
    const file = files[0];

    const story = await this.prisma.story.create({
      data: {
        userId,
        caption: options.caption,
        expiresAt,
        status: 'PROCESSING',
      },
    });

    const media = await this.prisma.storyMedia.create({
      data: {
        storyId: story.id,
        type: this.getMediaType(file),
        status: 'PENDING',
        localPath: file.path,
        duration: options?.duration,
      },
    });
    await this.storyQueue.add('process-story-media', {
      storyId: story.id,
      mediaId: media.id,
      localPath: file.path,
      mimeType: file.mimetype,
      userId,
      duration: options?.duration,
    });

    return this.prisma.story.findUnique({
      where: {
        id: story.id,
      },
      include: {
        media: true,
      },
    });
  }

  async getFeed(userId: string) {
    const stories = await this.prisma.story.findMany({
      where: {
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        media: true,
        user: {
          include: {
            profile: true,
          },
        },
        views: {
          where: {
            userId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    const grouped = new Map<
      string,
      {
        user: (typeof stories)[number]['user'];
        hasUnviewed: boolean;
        stories: {
          id: string;
          caption: string | null;
          createdAt: Date;
          expiresAt: Date;
          viewed: boolean;
          media: (typeof stories)[number]['media'];
        }[];
      }
    >();

    for (const story of stories) {
      const viewed = story.views.length > 0;

      if (!grouped.has(story.userId)) {
        grouped.set(story.userId, {
          user: story.user,
          hasUnviewed: !viewed,
          stories: [],
        });
      }

      const group = grouped.get(story.userId);

      if (!group) continue;

      if (!viewed) {
        group.hasUnviewed = true;
      }

      group.stories.push({
        id: story.id,
        caption: story.caption,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        viewed,
        media: story.media,
      });
    }

    const groupedStories = Array.from(grouped.values());
    return {
      data: groupedStories,
      meta: {
        page: 1,
        limit: 20,
        total: groupedStories.length,
        totalPages: 1,
        hasMore: false,
      },
    };
  }

  async getStoryById(userId: string, storyId: string) {
    const story = await this.getActiveStory(storyId);

    const [viewCount, reactionCount, userReaction] = await Promise.all([
      this.prisma.storyView.count({
        where: {
          storyId,
        },
      }),

      this.prisma.storyReaction.count({
        where: {
          storyId,
        },
      }),

      this.prisma.storyReaction.findUnique({
        where: {
          storyId_userId: {
            storyId,
            userId,
          },
        },
      }),
    ]);

    return {
      ...story,
      viewCount,
      reactionCount,
      userReaction: userReaction?.type ?? null,
    };
  }

  async viewStory(userId: string, storyId: string) {
    await this.getActiveStory(storyId);

    return this.prisma.storyView.upsert({
      where: {
        storyId_userId: {
          storyId,
          userId,
        },
      },
      create: {
        storyId,
        userId,
      },
      update: {
        viewedAt: new Date(),
      },
    });
  }

  async react(userId: string, storyId: string, type: ReactionType) {
    await this.getActiveStory(storyId);

    return this.prisma.storyReaction.upsert({
      where: {
        storyId_userId: {
          storyId,
          userId,
        },
      },
      create: {
        storyId,
        userId,
        type,
      },
      update: {
        type,
      },
    });
  }

  async replyToStory(userId: string, storyId: string, content: string) {
    const story = await this.getActiveStory(storyId);

    return this.prisma.storyReply.create({
      data: {
        storyId,
        senderId: userId,
        receiverId: story.userId,
        message: content,
      },
    });
  }

  async deleteStory(userId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.userId !== userId) {
      throw new ForbiddenException('You cannot delete this story');
    }

    await this.prisma.story.delete({
      where: {
        id: storyId,
      },
    });

    return {
      success: true,
    };
  }

  async getStoryViews(userId: string, storyId: string, page = 1, limit = 20) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
      },
      select: {
        userId: true,
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.userId !== userId) {
      throw new ForbiddenException('You cannot view story viewers');
    }

    const skip = (page - 1) * limit;

    const [views, total] = await Promise.all([
      this.prisma.storyView.findMany({
        where: {
          storyId,
        },
        skip,
        take: limit,
        orderBy: {
          viewedAt: 'desc',
        },
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      }),

      this.prisma.storyView.count({
        where: {
          storyId,
        },
      }),
    ]);

    return {
      data: views,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private getMediaType(file: Express.Multer.File): 'IMAGE' | 'VIDEO' {
    if (file.mimetype.startsWith('image')) return 'IMAGE';
    if (file.mimetype.startsWith('video')) return 'VIDEO';

    return 'IMAGE';
  }
}
