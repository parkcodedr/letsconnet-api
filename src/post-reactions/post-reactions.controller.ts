import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { PostReactionsService } from './post-reactions.service';
import { ReactionType } from './type';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostReactionsController {
  constructor(private readonly reactionsService: PostReactionsService) {}

  @Post(':postId/reactions')
  @HttpCode(HttpStatus.OK)
  async reactToPost(
    @CurrentUser('sub') userId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body('type') type: ReactionType,
  ) {
    return this.reactionsService.reactToPost(userId, postId, type);
  }

  @Get(':postId/reactions')
  async getPostReactions(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.reactionsService.getPostReactionSummary(postId, userId);
  }

  @Post('reactions/batch')
  @HttpCode(HttpStatus.OK)
  async getBatchPostsReactions(
    @Body('postIds') postIds: string[],
    @CurrentUser('sub') userId: string,
  ) {
    if (!postIds || !postIds.length) {
      return {};
    }

    if (postIds.length > 50) {
      postIds = postIds.slice(0, 50);
    }

    return this.reactionsService.getBatchPostsReactions(postIds, userId);
  }

  @Get(':postId/reactions/users')
  async getReactionUsers(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser('sub') userId: string,
    @Query('type') type?: ReactionType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.reactionsService.getReactionUsers(
      postId,
      userId,
      type,
      page,
      limit,
    );
  }

  @Get('my/reactions')
  async getMyReactionHistory(
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.reactionsService.getUserReactionHistory(userId, page, limit);
  }
}
