import { AuthenticatedSocket } from '../type/auth';
import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SocketEvents } from '../constant/socket-events';
import { WsJwtGuard } from 'src/auth/guards/ws-jwt.guard';
import { UseGuards } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3001', 'http://192.168.0.100:3000'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
@UseGuards(WsJwtGuard)
export class MediaGateway {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: AuthenticatedSocket) {
    console.log('media socket connected');
  }

  @SubscribeMessage(SocketEvents.JOIN_POST)
  handleJoinPost(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() postId: string,
  ) {
    client.join(`post:${postId}`);
  }

  emitMediaReady(postId: string, payload: unknown) {
    this.server.to(`post:${postId}`).emit(SocketEvents.MEDIA_READY, payload);
  }

  emitMediaProcessing(postId: string, status: string) {
    this.server.to(`post:${postId}`).emit(SocketEvents.MEDIA_PROCESSING, {
      status,
    });
  }

  emitMediaError(
    postId: string,
    payload: { mediaId: string; status: string; error: string },
  ) {
    this.server.to(`post:${postId}`).emit(SocketEvents.MEDIA_ERROR, payload);
  }

  emitChatMediaReady(chatId: string, payload: any) {
    this.server.to(`chat:${chatId}`).emit('chat-media-ready', payload);
  }
  emitChatMediaError(chatId: string, payload: any) {
    this.server.to(`chat:${chatId}`).emit('chat-media-error', payload);
  }
}
