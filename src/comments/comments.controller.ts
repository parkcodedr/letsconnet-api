// src/posts/controllers/comments.controller.ts
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
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/create-comment.dto';
import { ReactionType } from 'src/posts/types';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post(':postId/comments')
  @HttpCode(HttpStatus.CREATED)
  async createComment(
    @CurrentUser('sub') userId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(userId, postId, dto);
  }

  @Get(':postId/comments')
  async getPostComments(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('sortBy') sortBy?: 'newest' | 'oldest' | 'most_reactions',
  ) {
    return this.commentsService.getPostComments(
      postId,
      userId,
      page,
      Math.min(limit, 50),
      sortBy,
    );
  }

  @Get('comments/:commentId/replies')
  async getCommentReplies(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.commentsService.getCommentReplies(
      commentId,
      userId,
      page,
      Math.min(limit, 50),
    );
  }

  @Get('comments/:commentId')
  async getComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.commentsService.getCommentWithContext(commentId, userId);
  }

  @Put('comments/:commentId')
  async updateComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.updateComment(userId, commentId, dto.content);
  }

  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.OK)
  async deleteComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.commentsService.deleteComment(userId, commentId);
  }

  @Post('comments/:commentId/reactions')
  @HttpCode(HttpStatus.OK)
  async reactToComment(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body('type') type: ReactionType,
  ) {
    return this.commentsService.reactToComment(userId, commentId, type);
  }

  @Delete('comments/:commentId/reactions')
  @HttpCode(HttpStatus.OK)
  async removeCommentReaction(
    @CurrentUser('sub') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.commentsService.reactToComment(userId, commentId, null);
  }

  @Get('comments/:commentId/reactions/users')
  async getCommentReactionUsers(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('sub') userId: string,
    @Query('type') type?: ReactionType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.commentsService.getCommentReactionUsers(
      commentId,
      userId,
      type,
      page,
      limit,
    );
  }

  @Post('comments/reactions/batch')
  @HttpCode(HttpStatus.OK)
  async getBatchCommentsReactions(
    @Body('commentIds') commentIds: string[],
    @CurrentUser('sub') userId: string,
  ) {
    if (!commentIds || !commentIds.length) {
      return {};
    }

    if (commentIds.length > 50) {
      commentIds = commentIds.slice(0, 50);
    }

    return this.commentsService.getBatchCommentsReactions(commentIds, userId);
  }

  @Get('my/comment-reactions')
  async getUserCommentReactions(
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.commentsService.getUserCommentReactions(userId, page, limit);
  }
}
