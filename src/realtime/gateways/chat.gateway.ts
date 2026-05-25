// src/chat/chat.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard, AuthenticatedSocket } from 'src/auth/guards/ws-jwt.guard';
import {
  SendMessageDto,
  TypingDto,
  MarkReadDto,
  DeleteMessageDto,
  ForwardMessageDto,
  ClearChatDto,
} from 'src/chat/dto/chat.dto';
import { ChatService } from 'src/chat/chat.service';

@WebSocketGateway({
  cors: { origin: ['http://localhost:3001'], credentials: true },
  namespace: 'chat',
})
@UseGuards(WsJwtGuard)
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private userRooms = new Map<string, Set<string>>();

  constructor(private chatService: ChatService) {}

  async handleConnection(client: AuthenticatedSocket) {
    const userId = client.user?.id;
    if (!userId) return client.disconnect();
    await this.chatService.setUserOnline(userId);
    client.join(`user:${userId}`);
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.user?.id;
    if (userId) {
      await this.chatService.setUserOffline(userId);
      const rooms = this.userRooms.get(userId);
      if (rooms) rooms.forEach((rid) => client.leave(`chat:${rid}`));
      this.userRooms.delete(userId);
    }
  }

  @SubscribeMessage('join-chat')
  async handleJoinChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() chatId: string,
  ) {
    const userId = client.user!.id; // non‑null assertion (guard ensures user exists)
    const ok = await this.chatService.verifyParticipant(chatId, userId);
    if (!ok) return { error: 'Not authorized' };
    client.join(`chat:${chatId}`);
    if (!this.userRooms.has(userId)) this.userRooms.set(userId, new Set());
    this.userRooms.get(userId)!.add(chatId);
    const presences = await this.chatService.getChatPresence(userId, chatId);
    client.emit('presence-update', presences);
    return { success: true };
  }

  @SubscribeMessage('leave-chat')
  handleLeaveChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() chatId: string,
  ) {
    const userId = client.user!.id;
    client.leave(`chat:${chatId}`);
    this.userRooms.get(userId)?.delete(chatId);
    return { success: true };
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string; message: SendMessageDto },
  ) {
    const userId = client.user!.id;
    const message = await this.chatService.sendMessage(
      userId,
      data.chatId,
      data.message,
    );
    this.server.to(`chat:${data.chatId}`).emit('new-message', message);
    const participantIds = await this.chatService.getChatParticipantIds(
      data.chatId,
    );
    participantIds.forEach((pid) => {
      if (pid !== userId)
        this.server
          .to(`user:${pid}`)
          .emit('unread-update', { chatId: data.chatId });
    });
    return message;
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: TypingDto,
  ) {
    const userId = client.user!.id;
    client
      .to(`chat:${data.chatId}`)
      .emit('typing', { userId, isTyping: data.isTyping });
  }

  @SubscribeMessage('mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: MarkReadDto,
  ) {
    const userId = client.user!.id;
    await this.chatService.markMessagesAsRead(
      userId,
      data.chatId,
      data.messageId,
    );
    client
      .to(`chat:${data.chatId}`)
      .emit('read-receipt', {
        userId,
        chatId: data.chatId,
        messageId: data.messageId,
      });
    return { success: true };
  }

  @SubscribeMessage('delete-message')
  async handleDeleteMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: DeleteMessageDto,
  ) {
    const userId = client.user!.id;
    const result = await this.chatService.deleteMessage(
      userId,
      data.messageId,
      data.deleteType,
    );
    if (data.deleteType === 'FOR_EVERYONE') {
      this.server
        .to(`chat:${data.chatId}`)   // ✅ now data.chatId exists
        .emit('message-deleted', {
          messageId: data.messageId,
          forEveryone: true,
        });
    } else {
      client.emit('message-deleted', {
        messageId: data.messageId,
        forEveryone: false,
      });
    }
    return result;
  }

  @SubscribeMessage('forward-message')
  async handleForwardMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: ForwardMessageDto,
  ) {
    const userId = client.user!.id;
    const forwarded = await this.chatService.forwardMessage(userId, data);
    for (const chatId of data.targetChatIds) {
      this.server.to(`chat:${chatId}`).emit(
        'new-message',
        forwarded.find((f) => f.chatId === chatId),
      );
    }
    return forwarded;
  }

  @SubscribeMessage('clear-chat')
  async handleClearChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: ClearChatDto,
  ) {
    const userId = client.user!.id;
    await this.chatService.clearChat(userId, data.chatId);
    client.emit('chat-cleared', { chatId: data.chatId });
    return { success: true };
  }

  @SubscribeMessage('presence-ping')
  async handlePresencePing(@ConnectedSocket() client: AuthenticatedSocket) {
    await this.chatService.setUserOnline(client.user!.id);
  }
}