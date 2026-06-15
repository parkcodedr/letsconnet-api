
import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import { Server, ServerOptions, Socket } from 'socket.io';
import { verify, JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { SocketNamespaces } from '../constant/socket-events';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  [key: string]: unknown;
}


type RawSocket = Socket & { user?: JwtPayload };


export interface AuthenticatedSocket extends Socket {
  user: JwtPayload;
}

export class SocketIoAdapter extends IoAdapter {
  private readonly jwtSecret: string;
  private readonly allowedOrigins: string[];

  constructor(app: INestApplication) {
    super(app);
    const config = app.get(ConfigService);
    this.jwtSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.allowedOrigins = config
      .get<string>('ALLOWED_ORIGINS', 'http://localhost:3001')
      .split(',')
      .map((o) => o.trim());
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.allowedOrigins, credentials: true },
      transports: ['websocket', 'polling'],
      allowEIO3: true,
      pingTimeout: 60_000,
      pingInterval: 25_000,
    });

    const authMiddleware = this.buildAuthMiddleware();

    Object.values(SocketNamespaces).forEach((namespace) => {
      server.of(namespace).use(authMiddleware);
    });

    server.engine.on('connection_error', (err: Error) => {
      console.error('[WS Adapter] connection_error:', err.message);
    });

    return server;
  }

  private buildAuthMiddleware() {
    const secret = this.jwtSecret;

    
    return (socket: RawSocket, next: (err?: Error) => void): void => {
      try {
        const token = socket.handshake.auth?.token as string | undefined;

        if (!token) {
          return next(new Error('UNAUTHORIZED'));
        }

        const decoded = verify(token, secret) as JwtPayload;

        
        socket.user = decoded;
        next();
      } catch (err) {
        if (err instanceof TokenExpiredError) {
          return next(new Error('TOKEN_EXPIRED'));
        }
        if (err instanceof JsonWebTokenError) {
          return next(new Error('INVALID_TOKEN'));
        }
        next(new Error('UNAUTHORIZED'));
      }
    };
  }
}