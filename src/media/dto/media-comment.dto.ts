
import {
  IsString,
  
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReactionType } from 'src/posts/types';


export class CreateMediaCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class UpdateMediaCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class GetMediaCommentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  sortBy?: 'newest' | 'oldest' = 'newest';
}

export class MediaReactionDto {
  @IsString()
  type!: ReactionType;
}
