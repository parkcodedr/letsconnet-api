import { Module } from '@nestjs/common';
import { CloudinaryStorage } from 'src/common/storage/cloudinary.storage';
import { STORAGE_PROVIDER } from 'src/common/storage/storage.token';


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
