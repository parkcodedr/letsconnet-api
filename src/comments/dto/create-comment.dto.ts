
import {
  IsString,
  IsOptional,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string; 
}

export class UpdateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class GetCommentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  sortBy?: 'newest' | 'oldest' | 'most_reactions' = 'newest';
}
