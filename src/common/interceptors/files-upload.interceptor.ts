import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { getMaxFileSize } from 'src/auth/utils/post';

interface UploadOptions {
  fieldName?: string;
  maxCount?: number;
  destination?: string;
  maxFileSize?: number;
}

export function FilesUploadInterceptor(options?: UploadOptions) {
  const {
    fieldName = 'files',
    maxCount = 10,
    destination = './uploads/raw',
    maxFileSize = 100,
  } = options || {};

  return applyDecorators(
    UseInterceptors(
      FilesInterceptor(fieldName, maxCount, {
        storage: diskStorage({
          destination,
          filename: (_, file, callback) => {
            const uniqueSuffix =
              Date.now() + '-' + Math.round(Math.random() * 1e9);
            callback(null, `${uniqueSuffix}${extname(file.originalname)}`);
          },
        }),

        limits: {
          fileSize: getMaxFileSize(maxFileSize),
        },
      }),
    ),
  );
}
