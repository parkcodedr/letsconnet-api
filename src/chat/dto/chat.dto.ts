import {
  IsUUID,
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsEnum,
  MaxLength,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  SYSTEM = 'SYSTEM',
}

export enum DeleteType {
  FOR_ME = 'FOR_ME',
  FOR_EVERYONE = 'FOR_EVERYONE',
}

export class CreateDirectChatDto {
  @IsUUID()
  participantId!: string;
}

export class CreateGroupChatDto {
  @IsString()
  @MaxLength(100)
  title!: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsUUID(undefined, { each: true })
  participantIds!: string[];
}

export class SendMessageDto {
  @IsEnum(MessageType)
  type?: MessageType = MessageType.TEXT;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;
}

export class GetMessagesDto {
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
  limit?: number = 50;
}

export class TypingDto {
  @IsUUID()
  chatId!: string;
  @IsBoolean()
  isTyping!: boolean;
}

export class MarkReadDto {
  @IsUUID()
  chatId!: string;
  @IsOptional()
  @IsUUID()
  messageId?: string;
}

export class DeleteMessageDto {
  @IsUUID()
  chatId!: string;          
  @IsUUID()
  messageId!: string;
  @IsEnum(DeleteType)
  deleteType!: DeleteType;
}

export class ForwardMessageDto {
  @IsUUID()
  messageId!: string;
  @IsUUID(undefined, { each: true })
  targetChatIds!: string[];
  @IsOptional()
  @IsString()
  caption?: string;
}

export class ClearChatDto {
  @IsUUID()
  chatId!: string;
}
