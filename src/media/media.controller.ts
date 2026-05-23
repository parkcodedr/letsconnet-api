import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
import { MediaService } from './media.service';
import {
  CreateMediaCommentDto,
  MediaReactionDto,
  UpdateMediaCommentDto,
} from './dto/media-comment.dto';
import { ReactionType } from 'src/posts/types';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

 

  @Post(':mediaId/reactions')
  @HttpCode(HttpStatus.OK)
  async reactToMedia(
    @CurrentUser('sub') userId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: MediaReactionDto,
  ) {
    return this.mediaService.reactToMedia(userId, mediaId, dto.type);
  }

  @Delete(':mediaId/reactions')
  @HttpCode(HttpStatus.OK)
  async removeMediaReaction(
    @CurrentUser('sub') userId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.mediaService.reactToMedia(userId, mediaId, null);
  }

  @Get(':mediaId/reactions/summary')
  async getMediaReactionSummary(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.mediaService.getMediaReactionSummary(mediaId, userId);
  }

  @Get(':mediaId/reactions/users')
  async getMediaReactionUsers(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentUser('sub') userId: string,
    @Query('type') type?: ReactionType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.mediaService.getMediaReactionUsers(
      mediaId,
      userId,
      type,
      page,
      limit,
    );
  }

  @Post(':mediaId/comments')
  @HttpCode(HttpStatus.CREATED)
  async createMediaComment(
    @CurrentUser('sub') userId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: CreateMediaCommentDto,
  ) {
    return this.mediaService.createMediaComment(userId, mediaId, dto);
  }

  @Get(':mediaId/comments')
  async getMediaComments(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('sortBy') sortBy?: 'newest' | 'oldest' | 'most_reactions',
  ) {
    return this.mediaService.getMediaComments(
      mediaId,
      userId,
      page,
      Math.min(limit, 50),
      sortBy || 'newest',
    );
  }

  @Get('comments/:commentId/replies')
  async getMediaCommentReplies(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.mediaService.getMediaCommentReplies(
      commentId,
      userId,
      page,
      Math.min(limit, 50),
    );
  }

  @Get('comments/:commentId')
  async getMediaComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.mediaService.getMediaCommentWithContext(commentId, userId);
  }

  @Put('comments/:commentId')
  async updateMediaComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateMediaCommentDto,
  ) {
    return this.mediaService.updateMediaComment(userId, commentId, dto.content);
  }

  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.OK)
  async deleteMediaComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.mediaService.deleteMediaComment(userId, commentId);
  }

  @Post('comments/:commentId/reactions')
  @HttpCode(HttpStatus.OK)
  async reactToMediaComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body('type') type: ReactionType,
  ) {
    return this.mediaService.reactToMediaComment(userId, commentId, type);
  }

  @Delete('comments/:commentId/reactions')
  @HttpCode(HttpStatus.OK)
  async removeMediaCommentReaction(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.mediaService.reactToMediaComment(userId, commentId, null);
  }

  @Get('comments/:commentId/reactions/users')
  async getMediaCommentReactionUsers(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('sub') userId: string,
    @Query('type') type?: ReactionType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.mediaService.getMediaCommentReactionUsers(
      commentId,
      userId,
      type,
      page,
      limit,
    );
  }

  @Post('reactions/batch')
  @HttpCode(HttpStatus.OK)
  async getBatchMediaReactions(
    @Body('mediaIds') mediaIds: string[],
    @CurrentUser('sub') userId: string,
  ) {
    if (!mediaIds || !mediaIds.length) {
      return {};
    }

    if (mediaIds.length > 50) {
      mediaIds = mediaIds.slice(0, 50);
    }

    return this.mediaService.getBatchMediaReactions(mediaIds, userId);
  }

  @Get(':mediaId')
  async getMediaDetails(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.mediaService.getMediaWithDetails(mediaId, userId);
  }
}
