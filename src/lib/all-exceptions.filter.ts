import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CustomLoggerService } from 'src/custom-logger/custom-logger.service';

type MyResponseObj = {
  statusCode: number;
  timestamp: string;
  path: string;
  response: string | object;
};

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new CustomLoggerService(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    // Ignore WebSocket context
    if (host.getType() === 'ws') {
      super.catch(exception, host);
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Ignore Socket.IO handshake requests
    if (request?.url?.includes('/socket.io')) {
      super.catch(exception, host);
      return;
    }

    const myResponseObj: MyResponseObj = {
      statusCode: 500,
      timestamp: new Date().toISOString(),
      path: request.url,
      response: '',
    };

    if (exception instanceof ThrottlerException) {
      return response.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
      });
    }

    if (exception instanceof HttpException) {
      myResponseObj.statusCode = exception.getStatus();
      myResponseObj.response = exception.getResponse();
    } else if (isPrismaError(exception)) {
      myResponseObj.statusCode = 422;
      myResponseObj.response =
        exception.message?.replace?.(/\n/g, ' ') ?? 'Prisma validation error';
    } else {
      myResponseObj.statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      if (
        typeof exception === 'object' &&
        exception !== null &&
        'message' in exception
      ) {
        myResponseObj.response = (exception as any).message;
      } else {
        myResponseObj.response = 'Internal Server Error';
      }
    }

    response.status(myResponseObj.statusCode).json(myResponseObj);
    this.logger.error(myResponseObj.response, AllExceptionsFilter.name);

    super.catch(exception, host);
  }
}

// Helper type guard
function isPrismaError(e: unknown): e is { code?: string; message?: string } {
  return typeof e === 'object' && e !== null && 'message' in e && 'code' in e;
}
