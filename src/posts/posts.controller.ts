import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';

import { PostsService } from './posts.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { FilesUploadInterceptor } from 'src/common/interceptors/files-upload.interceptor';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @FilesUploadInterceptor({
    fieldName: 'files',
    maxCount: 10,
    destination: './uploads/raw',
    maxFileSize: 600,
  })
  async createPost(
    @CurrentUser('sub') userId: string,
    @Body('content') content?: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const trimmedContent = content?.trim();

    const hasContent = !!trimmedContent;
    const hasFiles = !!files?.length;

    if (!hasContent && !hasFiles) {
      throw new BadRequestException(
        'Post must contain text or at least one media file',
      );
    }

    return this.postsService.createPost(userId, trimmedContent, files);
  }

  @Get(':id')
  async getPostById(
    @CurrentUser('sub') userId: string,
    @Param('id') postId: string,
  ) {
    const post = await this.postsService.getPostById(userId, postId);

    if (!post) {
      throw new NotFoundException(`Post with ID ${postId} not found`);
    }

    return post;
  }

  @Get('user/me')
  async getMyPosts(
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(limit, 50);

    return this.postsService.getUserPosts(userId, page, safeLimit);
  }

  @Get('user/:userId')
  async getPostsByUserId(
    @CurrentUser('sub') currentUserId: string,
    @Param('userId') targetUserId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    // Cap limit to prevent abuse
    const safeLimit = Math.min(limit, 50);

    const posts = await this.postsService.getUserPosts(
      targetUserId,
      page,
      safeLimit,
    );

    if (!posts.data.length) {
      throw new NotFoundException(`No posts found for user ${targetUserId}`);
    }

    return posts;
  }

  @Post(':postId/share')
  async sharePost(
    @CurrentUser('sub') userId: string,
    @Param('postId') postId: string,
    @Body('caption') caption?: string,
  ) {
    return this.postsService.sharePost(userId, postId, caption);
  }
}
