export interface UploadedFile {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
}

export interface StorageProvider {
  uploadFile(path: string): Promise<UploadedFile>;

  deleteFile(publicId: string): Promise<void>;
}