import { getFileType } from 'src/auth/utils/post';
import cloudinary from './cloudinary.config';

import { UploadedFile } from './storage.interface';

export class CloudinaryStorage {
  async uploadFile(
    filePath: string,
    resourceType: 'image' | 'video',
  ): Promise<UploadedFile> {
    const finalResourceType = resourceType || getFileType(filePath);

    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'letsconnet/posts',
      resource_type: finalResourceType,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    };
  }
}
