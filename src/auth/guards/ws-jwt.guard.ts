
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { verify } from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

export interface AuthenticatedSocket extends Socket {
  user: {
    id: string;
    email: string;
  };
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: AuthenticatedSocket = context.switchToWs().getClient();

    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new WsException('Unauthorized: No token provided');
      }

      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        throw new WsException('Server configuration error: JWT_SECRET not set');
      }

      const decoded = verify(token, secret) as unknown as {
        sub: string;
        email: string;
      };

      client.user = {
        id: decoded.sub,
        email: decoded.email,
      };

      return true;
    } catch (error) {
      
      const wsError = error as Error;
      console.error('WebSocket authentication error:', wsError.message);
      throw new WsException('Unauthorized: Invalid token');
    }
  }

  private extractToken(client: AuthenticatedSocket): string | null {
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token;
    }

    if (client.handshake.query?.token) {
      return client.handshake.query.token as string;
    }

    if (client.handshake.headers?.authorization) {
      const auth = client.handshake.headers.authorization;
      if (typeof auth === 'string') {
        const [type, token] = auth.split(' ');
        if (type === 'Bearer' && token) {
          return token;
        }
      }
    }

    return null;
  }
}
