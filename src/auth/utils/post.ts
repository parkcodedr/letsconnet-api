const MB = 1024 * 1024;

export function getMaxFileSize(sizeInMb: number) {
  return sizeInMb * MB;
}

export function getFileType(
  filename: string,
): 'image' | 'video' | 'audio' | 'unknown' {
  const extension = filename.split('.').pop()?.toLowerCase() || '';

  const images = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
  if (images.includes(extension)) return 'image';

  const videos = [
    'mp4',
    'mov',
    'avi',
    'mkv',
    'webm',
    'flv',
    'wmv',
    'm4v',
    'mpg',
    'mpeg',
  ];
  if (videos.includes(extension)) return 'video';

  const audios = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'];
  if (audios.includes(extension)) return 'audio';

  return 'unknown';
}
