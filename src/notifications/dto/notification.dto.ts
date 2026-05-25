
import { IsUUID, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GetNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean = false;
}

export class MarkNotificationReadDto {
  @IsUUID()
  notificationId!: string;
}

export class MarkAllReadDto {
  @IsOptional()
  @Type(() => String)
  type?: string;
}

export interface NotificationResponse {
  id: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
  sender: {
    id: string;
    profile: {
      firstName: string;
      lastName: string;
      username: string;
      avatarUrl: string | null;
    };
  } | null;
  entity: {
    type: 'post' | 'comment' | 'friend_request';
    id: string;
    preview?: string;
    postId?: string;
    commentId?: string;
  } | null;
  metadata?: any;
}