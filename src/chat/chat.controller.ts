
import {
  Controller, Get, Post, Body, Param, Query, Delete, UseGuards, ParseUUIDPipe, UseInterceptors, UploadedFiles,
  BadRequestException, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { Express } from 'express';
import {
  CreateDirectChatDto,
  CreateGroupChatDto,
  SendMessageDto,
  GetMessagesDto,
  DeleteMessageDto,
  ForwardMessageDto,
  ClearChatDto,
  MessageType,          
} from './dto/chat.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('direct')
  createDirectChat(@CurrentUser('sub') userId: string, @Body() dto: CreateDirectChatDto) {
    return this.chatService.createDirectChat(userId, dto);
  }

  @Post('group')
  createGroupChat(@CurrentUser('sub') userId: string, @Body() dto: CreateGroupChatDto) {
    return this.chatService.createGroupChat(userId, dto);
  }

  @Get()
  getUserChats(
    @CurrentUser('sub') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.chatService.getUserChats(userId, page, limit);
  }

  @Get(':chatId')
  getChat(@CurrentUser('sub') userId: string, @Param('chatId', ParseUUIDPipe) chatId: string) {
    return this.chatService.getChatById(chatId, userId);
  }

  @Get(':chatId/messages')
  getMessages(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query() query: GetMessagesDto,
  ) {
    return this.chatService.getMessages(userId, chatId, query);
  }

  @Post(':chatId/messages')
  async sendMessage(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(userId, chatId, dto);
  }

  @Post(':chatId/messages/files')
  @UseInterceptors(FilesInterceptor('files', 10))
  async sendFilesMessage(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body('content') content: string,
    @Body('replyToId') replyToId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('At least one file required');
    
    const dto: SendMessageDto = { type: MessageType.TEXT, content, replyToId };
    return this.chatService.sendMessage(userId, chatId, dto, files);
  }

  @Delete('message')
  deleteMessage(@CurrentUser('sub') userId: string, @Body() dto: DeleteMessageDto) {
    return this.chatService.deleteMessage(userId, dto.messageId, dto.deleteType);
  }

  @Post('forward')
  forwardMessage(@CurrentUser('sub') userId: string, @Body() dto: ForwardMessageDto) {
    return this.chatService.forwardMessage(userId, dto);
  }

  @Post('clear')
  clearChat(@CurrentUser('sub') userId: string, @Body() dto: ClearChatDto) {
    return this.chatService.clearChat(userId, dto.chatId);
  }

  @Post(':chatId/read')
  markRead(
    @CurrentUser('sub') userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Body('messageId') messageId?: string,
  ) {
    return this.chatService.markMessagesAsRead(userId, chatId, messageId);
  }

  @Get('unread/counts')
  unreadCounts(@CurrentUser('sub') userId: string) {
    return this.chatService.getUnreadCounts(userId);
  }

  @Get('search')
  searchMessages(
    @CurrentUser('sub') userId: string,
    @Query('q') query: string,
    @Query('chatId') chatId?: string,
  ) {
    
    return this.chatService.searchMessages(userId, chatId ?? null, query);
  }
}