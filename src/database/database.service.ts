import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'generated/prisma/client';
import { CustomLoggerService } from 'src/custom-logger/custom-logger.service';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
    });
    super({ adapter });
  }
  private readonly logger = new CustomLoggerService(DatabaseService.name);

  private readonly maxRetries = 5;
  private retryCount = 0;
  async onModuleInit() {
    await this.connectWithRetry();
  }

  private async connectWithRetry() {
    try {
      await this.$connect();
      this.logger.log('Successfully connected to the database.');
    } catch (error) {
      this.retryCount++;
      this.logger.error(
        `Failed to connect to the database (Attempt ${this.retryCount}/${this.maxRetries}):`,
        error,
      );

      if (this.retryCount < this.maxRetries) {
        const delay = 5000; // 5 seconds delay
        this.logger.warn(`Retrying to connect in ${delay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.connectWithRetry();
      } else {
        this.logger.error(
          'Max retry attempts reached. Shutting down the application.',
        );
        process.exit(1); // Exit the application with an error code
      }
    }
  }
}
