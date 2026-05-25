
import { Module } from '@nestjs/common';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { MediaGateway } from './gateways/media.gateway';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [NotificationsModule,DatabaseModule],
  providers: [NotificationsGateway, MediaGateway],
  exports: [NotificationsGateway, MediaGateway],
})
export class RealtimeModule {}