import { getFileType } from 'src/auth/utils/post';
import cloudinary from './cloudinary.config';
import { UploadedFile, UploadOptions } from './storage.interface';

export class CloudinaryStorage {
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

    // Add media type subfolder
    folderParts.push(`${resourceType}s`);

    // Add thumbnail subfolder if needed
    if (options?.isThumbnail) {
      folderParts.push('thumbnails');
    }

    const folderPath = folderParts.join('/');

    // Create meaningful public ID
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const publicId = options?.customPublicId || `${timestamp}_${randomStr}`;

    console.log(`📁 Uploading to: ${folderPath}/${publicId}`);

    const uploadOptions: any = {
      folder: folderPath,
      public_id: publicId,
      resource_type: resourceType,
      // Add metadata for easy querying
      context: {
        post_id: options?.postId || '',
        user_id: options?.userId || '',
        media_type: resourceType,
        upload_time: timestamp.toString(),
      },
    };

    // Add type-specific optimizations
    if (resourceType === 'image') {
      uploadOptions.transformation = [
        { quality: 'auto:good' },
        { fetch_format: 'auto' },
      ];
    } else if (resourceType === 'video') {
      uploadOptions.quality = 'auto:low';
      uploadOptions.format = 'mp4';
      uploadOptions.eager = [
        { streaming_profile: 'hd', format: 'm3u8' },
        { format: 'mp4', quality: 'auto' },
      ];
      uploadOptions.eager_async = true;
    }

    const result = await cloudinary.uploader.upload(filePath, uploadOptions);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      folder: folderPath,
      resourceType: resourceType,
    };
  }

  // Helper to delete all media for a post
  async deletePostMedia(postId: string, userId: string): Promise<void> {
    const folderPath = `letsconnet/users/${userId}/posts/${postId}`;

    try {
      // Delete all resources in the folder
      const result =
        await cloudinary.api.delete_resources_by_prefix(folderPath);
      console.log(`✅ Deleted post ${postId} media:`, result);

      // Try to delete empty folders (optional)
      await cloudinary.api.delete_folder(folderPath).catch(() => {});
    } catch (error) {
      console.error(`❌ Error deleting post ${postId} media:`, error);
    }
  }
}
