import ffmpeg from './ffmpeg.config';
import * as path from 'path';
import { mkdir } from 'fs/promises';

const PROCESS_DIR = path.join(process.cwd(), 'uploads', 'processed');

export async function compressVideo(
  input: string,
  outputPath: string,
  timeoutMs?: number,
): Promise<string> {
  await mkdir(PROCESS_DIR, { recursive: true });

 

  const watermarkPath = path.resolve(
    process.cwd(),
    'assets',
    'watermark',
    'logo.png',
  );

  const effectiveTimeout = timeoutMs ?? 1_200_000;

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const command = ffmpeg(input)
      .inputOptions(['-fflags', '+genpts'])
      .input(watermarkPath)
      .complexFilter([
        {
          filter: 'scale',
          options: { w: 220, h: -1 },
          inputs: '1:v',
          outputs: 'watermark',
        },
        {
          filter: 'overlay',
          options: {
            x: 'main_w-overlay_w-30',
            y: '30',
          },
          inputs: ['0:v', 'watermark'],
          outputs: 'final',
        },
      ])
      .outputOptions([
        '-map [final]',
        '-map 0:a?',
        '-preset veryfast',
        '-crf 28',
      ])
      .videoCodec('libx264')
      .on('start', (cmd) => {
        console.log('[ffmpeg] started:', cmd);
        console.log('[ffmpeg] input:', input);
        console.log('[ffmpeg] output:', outputPath);
        console.log('[ffmpeg] cwd:', process.cwd());
      })
      .on('progress', (progress) => {
        console.log(`[ffmpeg] progress: ${progress.percent?.toFixed(1) ?? 0}%`);
      })
      .on('stderr', (line) => {
        console.log('[ffmpeg stderr]', line);
      })
      .on('end', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(outputPath);
        }
      })
      .on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      })
      .save(outputPath);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        command.kill('SIGKILL');
        reject(
          new Error(`Video compression timed out after ${effectiveTimeout}ms`),
        );
      }
    }, effectiveTimeout);
  });
}
