export interface UploadedFile {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  folder?: string;
  resourceType?: 'image' | 'video' | 'audio' | 'unknown' | undefined;
}

export interface UploadOptions {
  postId?: string;
  userId?: string;
  resourceType?: 'image' | 'video' | 'audio' | 'unknown' | undefined;
  isThumbnail?: boolean;
  temp?: boolean;
  customPublicId?: string;
}

export interface StorageProvider {
  uploadFile(filePath: string, options?: UploadOptions): Promise<UploadedFile>;
  uploadMultipleFiles(filePaths: string[], postId: string, userId: string): Promise<UploadedFile[]>;
  deletePostMedia(postId: string, userId: string): Promise<void>;
  getPostMedia?(postId: string, userId: string): Promise<any[]>;
}
