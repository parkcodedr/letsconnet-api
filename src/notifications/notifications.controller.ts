import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  GetNotificationsDto,
  
  MarkAllReadDto,
} from './dto/notification.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @CurrentUser('sub') userId: string,
    @Query() query: GetNotificationsDto,
  ) {
    return this.notificationsService.getUserNotifications(userId, query);
  }

  @Get('unread/count')
  async getUnreadCount(@CurrentUser('sub') userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
  }

  @Put(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  @Put('read/all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(
    @CurrentUser('sub') userId: string,
    @Body() dto: MarkAllReadDto,
  ) {
    return this.notificationsService.markAllAsRead(userId, dto.type);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteNotification(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notificationsService.deleteNotification(userId, notificationId);
  }
}
