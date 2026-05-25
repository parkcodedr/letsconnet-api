
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { DatabaseService } from 'src/database/database.service';
import { RedisCacheModule } from 'src/cache/redis-cache.module';
import { NotificationsGateway } from 'src/realtime/gateways/notifications.gateway';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [RedisCacheModule,DatabaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, DatabaseService],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}