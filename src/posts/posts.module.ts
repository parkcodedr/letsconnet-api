import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { DatabaseModule } from 'src/database/database.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { MediaProcessor } from './processors/media.processor';
import { MediaGateway } from 'src/realtime/gateways/media.gateway';



@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    BullModule.registerQueue({
      name: 'media-processing',
    }),
  ],

  controllers: [PostsController],

  providers: [PostsService, MediaProcessor,MediaGateway],
})
export class PostsModule {}