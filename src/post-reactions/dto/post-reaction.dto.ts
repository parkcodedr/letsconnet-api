import { ReactionType } from 'src/posts/types';
import { IsString } from 'class-validator';

export class ReactToPostDto {
  @IsString()
  type?: ReactionType;
}
