import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from './storage.token';
import { CloudinaryStorage } from './cloudinary.storage';
import { S3Storage } from './s3.storage';
import { FirebaseStorage } from './firebase.storage';

@Module({
  imports: [ConfigModule],
  providers: [
    CloudinaryStorage,
    S3Storage,
    FirebaseStorage,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (
        configService: ConfigService,
        cloudinary: CloudinaryStorage,
        s3: S3Storage,
        firebase: FirebaseStorage,
      ) => {
        const provider = configService.get<string>(
          'STORAGE_PROVIDER',
          'firesbase',
        );

        console.log({ provider });

        switch (provider.toLowerCase()) {
          case 's3':
            return s3;
          case 'firebase':
            return firebase;
          case 'cloudinary':
          default:
            return cloudinary;
        }
      },
      inject: [ConfigService, CloudinaryStorage, S3Storage, FirebaseStorage],
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
