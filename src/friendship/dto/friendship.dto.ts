import { IsEnum, IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum FriendshipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  BLOCKED = 'BLOCKED',
  DECLINED = 'DECLINED',
}

export class SendFriendRequestDto {
  @IsUUID()
  receiverId!: string;
}

export class RespondToFriendRequestDto {
  @IsEnum(FriendshipStatus)
  status!: FriendshipStatus.ACCEPTED | FriendshipStatus.DECLINED;
}

export class GetFriendsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  search?: string;

  @IsOptional()
  sortBy?: 'recent' | 'oldest' | 'name';
}

export class GetFriendRequestsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
