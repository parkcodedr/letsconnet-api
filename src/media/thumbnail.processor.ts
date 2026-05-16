import ffmpeg from './ffmpeg.config';

export async function generateThumbnail(input: string, filename: string) {
  return new Promise<string>((resolve, reject) => {
    const outputPath = `./uploads/thumbnails/${filename}`;

    ffmpeg(input)
      .screenshots({
        count: 1,
        folder: './uploads/thumbnails',
        filename,
        size: '720x?',
      })

      .on('end', () => resolve(outputPath))

      .on('error', reject);
  });
}
