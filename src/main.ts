import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module';

import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './lib/all-exceptions.filter';
import { SocketIoAdapter } from './realtime/adapters/socket-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule, {
    rawBody: true,
    bodyParser: true,
  });

  const { httpAdapter } = app.get(HttpAdapterHost);

  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

  app.enableCors({
    origin: ['http://localhost:3001', 'http://192.168.0.100:3000'],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException(
          errors
            .map((err) =>
              err.constraints
                ? Object.values(err.constraints).join(', ')
                : 'Invalid input',
            )
            .join('. '),
        ),
    }),
  );

  app.useWebSocketAdapter(new SocketIoAdapter(app));

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();