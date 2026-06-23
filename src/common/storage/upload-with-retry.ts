import { Logger } from '@nestjs/common';
import {
  StorageProvider,
  UploadedFile,
  UploadOptions,
} from './storage.interface';

const logger = new Logger('UploadWithRetry');

export async function uploadWithRetry(
  storage: StorageProvider,
  filePath: string,
  options: UploadOptions,
  maxRetries = 3,
): Promise<UploadedFile> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await storage.uploadFile(filePath, options);

      // Defensive check — never trust a silent "success" without a URL
      if (!result?.url) {
        throw new Error(
          `Upload returned no URL (attempt ${attempt}/${maxRetries}) for ${filePath}`,
        );
      }

      if (attempt > 1) {
        logger.log(`Upload succeeded on attempt ${attempt} for ${filePath}`);
      }

      return result;
    } catch (error: any) {
      lastError = error;
      logger.warn(
        `Upload attempt ${attempt}/${maxRetries} failed for ${filePath}: ${error.message}`,
      );

      if (attempt < maxRetries) {
        const delay = Math.min(2000 * 2 ** attempt, 15000);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }

  throw new Error(
    `All ${maxRetries} upload attempts failed for ${filePath}: ${lastError?.message}`,
  );
}
