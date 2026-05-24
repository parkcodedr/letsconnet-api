// src/feed/feed.controller.ts
import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { FeedService } from './feed.service';
import { GetFeedDto } from './dto/feed.dto';

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  async getFeed(
    @CurrentUser('sub') userId: string,
    @Query() query: GetFeedDto,
  ) {
    return this.feedService.getUserFeed(userId, query);
  }

  @Get('cursor')
  async getFeedCursor(
    @CurrentUser('sub') userId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.feedService.getUserFeedCursor(userId, Math.min(limit, 50), cursor);
  }
}