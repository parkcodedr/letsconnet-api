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

@WebSocketGateway({
  cors: true,
})
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

  emitMediaProcessing(postId: string, progress: number) {
    this.server.to(`post:${postId}`).emit(SocketEvents.MEDIA_PROCESSING, {
      progress,
    });
  }
}
