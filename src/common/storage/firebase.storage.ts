// firebase.storage.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getStorage, Storage } from 'firebase-admin/storage';
import * as fs from 'fs';
import * as path from 'path';
import { getFileType } from 'src/auth/utils/post';
import {
  StorageProvider,
  UploadedFile,
  UploadOptions,
} from './storage.interface';

@Injectable()
export class FirebaseStorage implements StorageProvider {
  private readonly logger = new Logger(FirebaseStorage.name);
  private readonly bucket: ReturnType<Storage['bucket']>;
  private app: App;

  constructor(private readonly configService: ConfigService) {
    const existingApps = getApps();

    this.app = existingApps.length
      ? existingApps[0]
      : initializeApp({
          credential: cert({
            projectId: this.configService.get<string>('FIREBASE_PROJECT_ID'),
            clientEmail: this.configService.get<string>('FIREBASE_CLIENT_EMAIL'),
            privateKey: this.configService
              .get<string>('FIREBASE_PRIVATE_KEY')!
              .replace(/\\n/g, '\n'),
          }),
          storageBucket: this.configService.get<string>('FIREBASE_STORAGE_BUCKET'),
        });

    this.bucket = getStorage(this.app).bucket();
    this.logger.log(`Firebase bucket initialized: ${this.bucket.name}`);
  }

  private buildPath(filePath: string, options?: UploadOptions): string {
    const resourceType = options?.resourceType || getFileType(filePath);
    const parts = ['letsconnet'];

    if (options?.userId) parts.push(`users/${options.userId}`);
    if (options?.postId) parts.push(`posts/${options.postId}`);
    else if (options?.temp) parts.push('temp');

    parts.push(`${resourceType}s`);
    if (options?.isThumbnail) parts.push('thumbnails');

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const ext = path.extname(filePath);
    const fileName = options?.customPublicId
      ? `${options.customPublicId}${ext}`
      : `${timestamp}_${randomStr}${ext}`;

    parts.push(fileName);
    return parts.join('/');
  }

  async uploadFile(
    filePath: string,
    options?: UploadOptions,
  ): Promise<UploadedFile> {
    const resourceType = options?.resourceType || getFileType(filePath);
    const destination = this.buildPath(filePath, options);

    // Confirm the local file actually exists before attempting upload
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch (statError: any) {
      this.logger.error(`Cannot stat local file ${filePath}: ${statError.message}`);
      throw new Error(`Local file inaccessible: ${filePath} — ${statError.message}`);
    }

    this.logger.log(
      `[Firebase] Starting upload: ${filePath} (${stats.size} bytes) → ${destination}`,
    );

    const dynamicTimeout = Math.max(120000, stats.size / 1024 / 100);

    try {
      await this.bucket.upload(filePath, {
        destination,
        resumable: stats.size > 5 * 1024 * 1024,
        timeout: dynamicTimeout,
        metadata: {
          metadata: {
            postId: options?.postId || '',
            userId: options?.userId || '',
            mediaType: resourceType || 'unknown',
          },
        },
      });
      this.logger.log(`[Firebase] bucket.upload() resolved for ${destination}`);
    } catch (uploadError: any) {
      // THIS is the error that was being swallowed before
      this.logger.error(
        `[Firebase] bucket.upload() threw for ${destination}: ${uploadError.message}`,
        uploadError.stack,
      );
      // Surface Firebase/GCS-specific error details if present
      if (uploadError.code) {
        this.logger.error(`[Firebase] Error code: ${uploadError.code}`);
      }
      if (uploadError.errors) {
        this.logger.error(`[Firebase] Error details: ${JSON.stringify(uploadError.errors)}`);
      }
      throw new Error(`Firebase upload failed: ${uploadError.message}`);
    }

    const file = this.bucket.file(destination);

    let exists: boolean;
    try {
      [exists] = await file.exists();
    } catch (existsError: any) {
      this.logger.error(
        `[Firebase] file.exists() check failed for ${destination}: ${existsError.message}`,
      );
      throw new Error(`Could not verify upload: ${existsError.message}`);
    }

    if (!exists) {
      this.logger.error(`[Firebase] Upload reported success but file.exists() = false: ${destination}`);
      throw new Error(`Firebase upload failed silently — file not found at ${destination}`);
    }

    let metadata: any;
    try {
      [metadata] = await file.getMetadata();
    } catch (metaError: any) {
      this.logger.error(
        `[Firebase] getMetadata() failed for ${destination}: ${metaError.message}`,
      );
      throw new Error(`Could not read uploaded file metadata: ${metaError.message}`);
    }

    if (Number(metadata.size) !== stats.size) {
      this.logger.error(
        `[Firebase] Size mismatch for ${destination}: local=${stats.size}, remote=${metadata.size}`,
      );
      throw new Error(
        `Upload incomplete — expected ${stats.size} bytes, got ${metadata.size} bytes`,
      );
    }

    try {
      await file.makePublic();
    } catch (publicError: any) {
      this.logger.error(
        `[Firebase] makePublic() failed for ${destination}: ${publicError.message}`,
      );
      throw new Error(`Failed to make file public: ${publicError.message}`);
    }

    const url = `https://storage.googleapis.com/${this.bucket.name}/${destination}`;

    this.logger.log(`[Firebase] Upload complete: ${url}`);

    return {
      url,
      publicId: destination,
      bytes: stats.size,
      folder: path.dirname(destination),
      resourceType,
    };
  }

  async uploadMultipleFiles(
    filePaths: string[],
    postId: string,
    userId: string,
  ): Promise<UploadedFile[]> {
    return Promise.all(
      filePaths.map((p) => this.uploadFile(p, { postId, userId })),
    );
  }

  async deletePostMedia(postId: string, userId: string): Promise<void> {
    const prefix = `letsconnet/users/${userId}/posts/${postId}`;
    const [files] = await this.bucket.getFiles({ prefix });
    await Promise.all(files.map((f) => f.delete()));
  }

  async getPostMedia(postId: string, userId: string): Promise<any[]> {
    const prefix = `letsconnet/users/${userId}/posts/${postId}`;
    const [files] = await this.bucket.getFiles({ prefix });
    return files;
  }
}