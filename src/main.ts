import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './lib/all-exceptions.filter';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { SocketIoAdapter } from './realtime/adapters/socket-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
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
      exceptionFactory: (errors) => {
        const errorMessages = errors
          .map((err) =>
            err.constraints
              ? Object.values(err.constraints).join(', ')
              : 'Invalid input',
          )
          .join('. ');

        return new BadRequestException(errorMessages);
      },
    }),
  );
  app.useWebSocketAdapter(new SocketIoAdapter(app));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
