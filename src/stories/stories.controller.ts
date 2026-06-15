import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
  UploadedFiles,
} from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { FilesUploadInterceptor } from 'src/common/interceptors/files-upload.interceptor';
import { StoriesService } from './stories.service';
import { ReactionType } from 'src/posts/types';

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post()
  @FilesUploadInterceptor({
    fieldName: 'files',
    maxCount: 1,
    destination: './uploads/raw',
    maxFileSize: 600,
  })
  async createStory(
    @CurrentUser('sub') userId: string,
    @Body('caption') caption?: string,
    @Body('duration') duration?: string,
    @Body('audience') audience?: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('Story requires at least one media file');
    }

    return this.storiesService.createStory(
      userId,
      {
        caption: caption?.trim(),
        duration: duration ? Number(duration) : undefined,
        audience,
      },
      files,
    );
  }

  @Get('story-feed')
  async getStoriesFeed(@CurrentUser('sub') userId: string) {
    return this.storiesService.getFeed(userId);
  }

  @Get(':storyId')
  async getStory(
    @CurrentUser('sub') userId: string,
    @Param('storyId') storyId: string,
  ) {
    return this.storiesService.getStoryById(userId, storyId);
  }

  @Post(':storyId/view')
  async viewStory(
    @CurrentUser('sub') userId: string,
    @Param('storyId') storyId: string,
  ) {
    return this.storiesService.viewStory(userId, storyId);
  }

  @Post(':storyId/react')
  async reactToStory(
    @CurrentUser('sub') userId: string,
    @Param('storyId') storyId: string,
    @Body('type') type: ReactionType,
  ) {
    return this.storiesService.react(userId, storyId, type);
  }

  @Post(':storyId/reply')
  async replyToStory(
    @CurrentUser('sub') userId: string,
    @Param('storyId') storyId: string,
    @Body('content') content: string,
  ) {
    return this.storiesService.replyToStory(userId, storyId, content);
  }

  @Delete(':storyId')
  async deleteStory(
    @CurrentUser('sub') userId: string,
    @Param('storyId') storyId: string,
  ) {
    return this.storiesService.deleteStory(userId, storyId);
  }

  @Get(':storyId/views')
  async getStoryViews(
    @CurrentUser('sub') userId: string,
    @Param('storyId') storyId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe)
    page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe)
    limit: number,
  ) {
    return this.storiesService.getStoryViews(userId, storyId, page, limit);
  }
}
