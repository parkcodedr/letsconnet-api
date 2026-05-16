import sharp from 'sharp';
import * as path from 'path';
import { mkdir } from 'fs/promises';

const PROCESS_DIR = path.join(process.cwd(), 'uploads', 'processed');

export async function processImage(inputPath: string, outputFileName: string) {
  await mkdir(PROCESS_DIR, { recursive: true });

  const outputPath = path.join(PROCESS_DIR, outputFileName);

  const image = sharp(inputPath);

  const metadata = await image.metadata();

  await image
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 82,
      progressive: true,
      mozjpeg: true,
    })
    .toFile(outputPath);

  return {
    outputPath,
    width: metadata.width,
    height: metadata.height,
  };
}
