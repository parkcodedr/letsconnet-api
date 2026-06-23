import { getFileType } from 'src/auth/utils/post';
import {
  StorageProvider,
  UploadedFile,
  UploadOptions,
} from './storage.interface';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CloudinaryStorage implements StorageProvider {
  private readonly logger = new Logger(CloudinaryStorage.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
      timeout: 120000,
    });
  }

  async uploadFile(
    filePath: string,
    options?: UploadOptions,
  ): Promise<UploadedFile> {
    const resourceType = options?.resourceType || getFileType(filePath);

    const folderParts = ['letsconnet'];

    if (options?.userId) {
      folderParts.push(`users/${options.userId}`);
    }

    if (options?.postId) {
      folderParts.push(`posts/${options.postId}`);
    } else if (options?.temp) {
      folderParts.push('temp');
    }

    folderParts.push(`${resourceType}s`);

    if (options?.isThumbnail) {
      folderParts.push('thumbnails');
    }

    const folderPath = folderParts.join('/');

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const publicId = options?.customPublicId || `${timestamp}_${randomStr}`;

    this.logger.log(
      `Uploading to: ${folderPath}/${publicId} (type: ${resourceType})`,
    );

    const uploadOptions: any = {
      folder: folderPath,
      public_id: publicId,
      resource_type: resourceType,
      timeout: 120000,
      context: {
        post_id: options?.postId || '',
        user_id: options?.userId || '',
        media_type: resourceType,
        upload_time: timestamp.toString(),
      },
    };

    try {
      let result: any;

      if (resourceType === 'image') {
        uploadOptions.transformation = [
          { quality: 'auto:good' },
          { fetch_format: 'auto' },
        ];
        result = await cloudinary.uploader.upload(filePath, uploadOptions);
      } else if (resourceType === 'video') {
        uploadOptions.quality = 'auto:low';
        uploadOptions.format = 'mp4';
        // Eager transformations removed from the synchronous path —
        // they can cause upload_large to return an incomplete response
        // on large files. Queue them separately if streaming variants
        // are needed, instead of blocking the primary upload result.

        result = await cloudinary.uploader.upload_large(
          filePath,
          uploadOptions,
        );
      } else {
        result = await cloudinary.uploader.upload(filePath, uploadOptions);
      }

      return this.validateAndMapResult(
        result,
        folderPath,
        resourceType,
        filePath,
      );
    } catch (error: any) {
      this.logCloudinaryError(error, filePath, resourceType);

      throw new Error(
        `Cloudinary upload failed for ${filePath}: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * Validates the Cloudinary response has the fields we depend on.
   * Cloudinary's SDK can resolve successfully with an incomplete object
   * on large/chunked uploads — this turns that into an explicit error
   * instead of a silent `undefined` propagating downstream.
   */
  private validateAndMapResult(
    result: any,
    folderPath: string,
    resourceType: string,
    filePath: string,
  ): UploadedFile {
    if (!result) {
      this.logger.error(`Cloudinary returned no result object for ${filePath}`);
      throw new Error('Cloudinary returned an empty response');
    }

    if (!result.secure_url) {
      this.logger.error(
        `Cloudinary response missing secure_url for ${filePath}. Full response: ${JSON.stringify(result)}`,
      );
      throw new Error(
        `Cloudinary returned no secure_url (response keys: ${Object.keys(result).join(', ') || 'none'})`,
      );
    }

    if (!result.public_id) {
      this.logger.warn(`Cloudinary response missing public_id for ${filePath}`);
    }

    this.logger.log(`Upload confirmed: ${result.secure_url}`);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      folder: folderPath,
      resourceType: resourceType as
        | 'image'
        | 'video'
        | 'audio'
        | 'unknown'
        | undefined,
    };
  }

  /**
   * Logs the full, structured Cloudinary error so the real cause
   * (timeout, invalid signature, quota, malformed file, network drop)
   * is always visible instead of being collapsed into a generic message.
   */
  private logCloudinaryError(
    error: any,
    filePath: string,
    resourceType: string,
  ): void {
    this.logger.error(
      `Cloudinary upload threw for ${filePath} (${resourceType})`,
      {
        message: error?.message,
        name: error?.name,
        http_code: error?.http_code,
        error: error?.error,
        stack: error?.stack,
      },
    );
  }

  private extractErrorMessage(error: any): string {
    if (error?.error?.message) return error.error.message;
    if (error?.message) return error.message;
    return 'Unknown Cloudinary error';
  }

  async deletePostMedia(postId: string, userId: string): Promise<void> {
    const folderPath = `letsconnet/users/${userId}/posts/${postId}`;

    try {
      const result =
        await cloudinary.api.delete_resources_by_prefix(folderPath);
      this.logger.log(
        `Deleted post ${postId} media: ${JSON.stringify(result)}`,
      );

      await cloudinary.api.delete_folder(folderPath).catch((err) => {
        this.logger.warn(
          `Could not delete empty folder ${folderPath}: ${err.message}`,
        );
      });
    } catch (error: any) {
      this.logger.error(
        `Error deleting post ${postId} media: ${error.message}`,
        error.stack,
      );
      throw new Error(
        `Failed to delete post media: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  async uploadMultipleFiles(
    filePaths: string[],
    postId: string,
    userId: string,
  ): Promise<UploadedFile[]> {
    const results = await Promise.allSettled(
      filePaths.map((path) => this.uploadFile(path, { postId, userId })),
    );

    const successes: UploadedFile[] = [];
    const failures: { path: string; error: string }[] = [];

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        successes.push(result.value);
      } else {
        failures.push({ path: filePaths[i], error: result.reason?.message });
      }
    });

    if (failures.length > 0) {
      this.logger.error(
        `${failures.length}/${filePaths.length} uploads failed: ${JSON.stringify(failures)}`,
      );
    }

    if (successes.length === 0) {
      throw new Error(
        `All ${filePaths.length} uploads failed: ${failures.map((f) => f.error).join('; ')}`,
      );
    }

    return successes;
  }

  async getPostMedia(postId: string, userId: string): Promise<any[]> {
    const folderPath = `letsconnet/users/${userId}/posts/${postId}`;

    try {
      const result = await cloudinary.api.resources({
        type: 'upload',
        prefix: folderPath,
        max_results: 100,
      });
      return result.resources;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch post media for ${postId}: ${error.message}`,
        error.stack,
      );
      throw new Error(
        `Failed to fetch post media: ${this.extractErrorMessage(error)}`,
      );
    }
  }
}
