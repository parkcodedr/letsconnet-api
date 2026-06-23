import ffmpeg from './ffmpeg.config';

export function getVideoDuration(input: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration ?? 0);
    });
  });
}