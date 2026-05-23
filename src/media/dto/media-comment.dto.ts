import {
  IsString,
  IsOptional,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ReactionType } from 'src/posts/types';

export class CreateMediaCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateMediaCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class MediaReactionDto {
  @IsString()
  type!: ReactionType;
}

export class GetMediaCommentsQueryDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;

  @IsOptional()
  parentId?: string;

  @IsOptional()
  sortBy?: 'newest' | 'oldest' | 'most_reactions' = 'newest';
}
