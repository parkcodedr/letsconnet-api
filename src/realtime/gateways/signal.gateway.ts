// src/realtime/gateways/signal.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { AuthenticatedSocket } from '../adapters/socket-io.adapter';
import { BaseGateway } from './base.gateway';
import { SignalEvents, SocketNamespaces } from '../constant/socket-events';

interface CallOfferDto {
  targetUserId: string;
  sdp: string;
  callType: 'audio' | 'video';
}

interface CallAnswerDto {
  targetUserId: string;
  sdp: string;
}

interface IceCandidateDto {
  targetUserId: string;
  candidate: string;
}

interface CallEndDto {
  targetUserId: string;
}

@WebSocketGateway({ namespace: SocketNamespaces.SIGNAL })
export class SignalGateway extends BaseGateway {
  protected readonly logger = new Logger(SignalGateway.name);

  handleConnection(client: AuthenticatedSocket): void {
    const ok = this.onConnect(client);
    if (!ok) return;

    client.emit(SignalEvents.CONNECTED, { userId: client.user.sub });
  }

  @SubscribeMessage(SignalEvents.CALL_OFFER)
  handleCallOffer(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { targetUserId, sdp, callType }: CallOfferDto,
  ): void {
    this.emitToUser(targetUserId, SignalEvents.INCOMING_CALL, {
      fromUserId: client.user.sub,
      sdp,
      callType,
    });
  }

  @SubscribeMessage(SignalEvents.CALL_ANSWER)
  handleCallAnswer(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { targetUserId, sdp }: CallAnswerDto,
  ): void {
    this.emitToUser(targetUserId, SignalEvents.CALL_ACCEPTED, {
      fromUserId: client.user.sub,
      sdp,
    });
  }

  @SubscribeMessage(SignalEvents.ICE_CANDIDATE)
  handleIceCandidate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { targetUserId, candidate }: IceCandidateDto,
  ): void {
    this.emitToUser(targetUserId, SignalEvents.ICE_RELAY, {
      fromUserId: client.user.sub,
      candidate,
    });
  }

  @SubscribeMessage(SignalEvents.CALL_END)
  handleCallEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() { targetUserId }: CallEndDto,
  ): void {
    this.emitToUser(targetUserId, SignalEvents.CALL_ENDED, {
      fromUserId: client.user.sub,
    });
  }
}
