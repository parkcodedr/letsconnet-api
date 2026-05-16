import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
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
}
