import * as path from 'path';
import ffmpeg from './ffmpeg.config';

export async function compressVideo(
  input: string,
  output: string,
  timeoutMs?: number,
) {
  return new Promise<void>((resolve, reject) => {
    const watermarkPath = path.resolve('assets/watermark/logo.png');

  
    const effectiveTimeout = timeoutMs ?? 1200000;

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        command.kill('SIGKILL');
        reject(new Error(`Video compression timed out after ${effectiveTimeout}ms`));
      }
    }, effectiveTimeout);

    const command = ffmpeg(input)
      .inputOptions(['-fflags', '+genpts'])
      .input(watermarkPath)
      .complexFilter([
        { filter: 'scale', options: { w: 220, h: -1 }, inputs: '1:v', outputs: 'watermark' },
        { filter: 'overlay', options: { x: 'main_w-overlay_w-30', y: '30' }, inputs: ['0:v', 'watermark'], outputs: 'final' },
      ])
      .outputOptions(['-map [final]', '-map 0:a?', '-preset veryfast', '-crf 28'])
      .videoCodec('libx264')
      .on('start', (cmd) => console.log('[ffmpeg] started:', cmd))
      .on('progress', (progress) => console.log(`[ffmpeg] progress: ${progress.percent?.toFixed(1)}%`))
      .on('stderr', (line) => console.log('[ffmpeg stderr]', line))
      .on('end', () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      })
      .on('error', (err) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(err); }
      })
      .save(output);
  });
}
