import ffmpeg from 'fluent-ffmpeg';

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

ffmpeg.setFfmpegPath(FFMPEG_PATH);

export default ffmpeg;
