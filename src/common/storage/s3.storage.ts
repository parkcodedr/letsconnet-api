import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import * as fs from 'fs';
import * as path from 'path';
import { getFileType } from 'src/auth/utils/post';
import {
  StorageProvider,
  UploadedFile,
  UploadOptions,
} from './storage.interface';

@Injectable()
export class S3Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicBaseUrl?: string;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET')!;
    this.publicBaseUrl = this.configService.get<string>('AWS_S3_PUBLIC_URL');

    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        )!,
      },
      maxAttempts: 3,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 10000,
        requestTimeout: 120000,
      }),
    });
  }

  private buildKey(filePath: string, options?: UploadOptions): string {
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
    const key = this.buildKey(filePath, options);
    const stats = fs.statSync(filePath);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: stats.size,
        ContentType: this.getContentType(filePath, resourceType),
        Metadata: {
          postId: options?.postId || '',
          userId: options?.userId || '',
          mediaType: resourceType || 'unknown',
        },
      }),
    );

    const url = this.publicBaseUrl
      ? `${this.publicBaseUrl}/${key}`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

    return {
      url,
      publicId: key,
      bytes: stats.size,
      folder: path.dirname(key),
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

    const listed = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );

    if (!listed.Contents?.length) return;

    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: listed.Contents.map((obj) => ({ Key: obj.Key! })),
        },
      }),
    );
  }

  async getPostMedia(postId: string, userId: string): Promise<any[]> {
    const prefix = `letsconnet/users/${userId}/posts/${postId}`;
    const result = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );
    return result.Contents ?? [];
  }

  private getContentType(filePath: string, resourceType?: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
    };
    return map[ext] || 'application/octet-stream';
  }
}
