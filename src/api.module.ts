import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { EventListenerModule } from './events/event-listener.module';

@Module({
  imports: [
    AppModule,

    // API-only runtime stuff
    EventListenerModule,
  ],
})
export class ApiModule {}