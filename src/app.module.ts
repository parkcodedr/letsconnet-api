import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CustomLoggerService } from './custom-logger/custom-logger.service';
import { DatabaseService } from './database/database.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { PostsModule } from './posts/posts.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    DatabaseModule,
    PostsModule,
    QueueModule,
  ],
  controllers: [AppController],
  providers: [AppService, CustomLoggerService, DatabaseService],
})
export class AppModule {}
