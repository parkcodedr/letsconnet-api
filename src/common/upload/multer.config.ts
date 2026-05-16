import { diskStorage } from 'multer';

import { extname } from 'path';

import { randomUUID } from 'crypto';

export const multerConfig = {
  storage: diskStorage({
    destination: './uploads/temp',

    filename: (_, file, callback) => {
      callback(
        null,
        `${randomUUID()}${extname(file.originalname)}`,
      );
    },
  }),
};