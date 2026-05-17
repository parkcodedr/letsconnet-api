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
import { PostReactionsService } from './post-reactions/post-reactions.service';
import { PostReactionsController } from './post-reactions/post-reactions.controller';
import { RedisCacheModule } from './cache/redis-cache.module';
import { CommentsService } from './comments/comments.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsModule } from './comments/comments.module';

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
    RedisCacheModule,
    CommentsModule,
  ],
  controllers: [AppController, PostReactionsController, CommentsController],
  providers: [
    AppService,
    CustomLoggerService,
    DatabaseService,
    PostReactionsService,
    CommentsService,
  ],
})
export class AppModule {}
