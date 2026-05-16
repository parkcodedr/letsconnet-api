import * as path from 'path';

import ffmpeg from './ffmpeg.config';

export async function compressVideo(
  input: string,
  output: string,
) {
  return new Promise<void>((resolve, reject) => {
    const watermarkPath = path.resolve(
      'assets/watermark/logo.png',
    );

    ffmpeg(input)

      .input(watermarkPath)

      .complexFilter([
       
        {
          filter: 'scale',

          options: {
            w: 220,
            h: -1,
          },

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

        '-preset fast',
        '-crf 28',
      ])

      .videoCodec('libx264')

      .save(output)

      .on('end', () => resolve())

      .on('error', reject);
  });
}