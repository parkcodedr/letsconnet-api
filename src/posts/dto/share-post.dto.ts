import { IsString, IsOptional, MaxLength } from 'class-validator';

export class SharePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;
}

export class GetSharedPostsQueryDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 20;
}
