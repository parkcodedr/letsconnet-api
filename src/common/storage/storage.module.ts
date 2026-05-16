import { Module } from '@nestjs/common';
import { STORAGE_PROVIDER } from './storage.token';
import { CloudinaryStorage } from './cloudinary.storage';

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useClass: CloudinaryStorage,
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
