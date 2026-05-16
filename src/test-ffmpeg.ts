import ffmpeg from "./media/ffmpeg.config";


ffmpeg.getAvailableFormats((err, formats) => {
  if (err) {
    console.error(err);
    return;
  }

  console.log('FFMPEG WORKING');
});
