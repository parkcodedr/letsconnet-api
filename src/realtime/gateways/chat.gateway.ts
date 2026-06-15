import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { AuthenticatedSocket } from '../adapters/socket-io.adapter';
import { BaseGateway } from './base.gateway';
import { ChatEvents, SocketNamespaces } from '../constant/socket-events';

interface JoinChatDto {
  chatId: string;
}

interface TypingDto {
  chatId: string;
}

interface MarkReadDto {
  chatId: string;
  messageId: string;
}

@WebSocketGateway({ namespace: SocketNamespaces.CHAT })
export class ChatGateway extends BaseGateway {
  protected readonly logger = new Logger(ChatGateway.name);

  handleConnection(client: AuthenticatedSocket): void {
    const ok = this.onConnect(client);
    if (!ok) return;

    client.emit(ChatEvents.CONNECTED, { userId: client.user.sub });
  }

  @SubscribeMessage(ChatEvents.JOIN_CHAT)
  handleJoinChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { chatId }: JoinChatDto,
  ): void {
    client.join(`chat:${chatId}`);
    this.logger.debug(`${client.user.sub} joined chat:${chatId}`);
  }

  @SubscribeMessage(ChatEvents.LEAVE_CHAT)
  handleLeaveChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { chatId }: JoinChatDto,
  ): void {
    client.leave(`chat:${chatId}`);
  }

  @SubscribeMessage(ChatEvents.TYPING_START)
  handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { chatId }: TypingDto,
  ): void {
    client.to(`chat:${chatId}`).emit(ChatEvents.TYPING, {
      chatId,
      userId: client.user.sub,
      isTyping: true,
    });
  }

  @SubscribeMessage(ChatEvents.TYPING_STOP)
  handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { chatId }: TypingDto,
  ): void {
    client.to(`chat:${chatId}`).emit(ChatEvents.TYPING, {
      chatId,
      userId: client.user.sub,
      isTyping: false,
    });
  }

  @SubscribeMessage(ChatEvents.MARK_READ)
  handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { chatId, messageId }: MarkReadDto,
  ): void {
    client.to(`chat:${chatId}`).emit(ChatEvents.MESSAGE_READ, {
      chatId,
      messageId,
      userId: client.user.sub,
      readAt: new Date().toISOString(),
    });
  }

  emitNewMessage(chatId: string, payload: Record<string, unknown>): void {
    this.emitToRoom(`chat:${chatId}`, ChatEvents.NEW_MESSAGE, payload);
  }

  emitUserOnline(userId: string): void {
    this.server.emit(ChatEvents.USER_ONLINE, { userId });
  }

  emitUserOffline(userId: string): void {
    this.server.emit(ChatEvents.USER_OFFLINE, { userId });
  }
}
