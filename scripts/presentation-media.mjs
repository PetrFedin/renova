import { spawnSync } from 'node:child_process';

export function validateClipProbe(probe) {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(probe.format?.duration);
  if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p') {
    throw new Error('Presentation clip must be H.264 yuv420p');
  }
  if (!Number.isFinite(duration) || duration < 24.9 || duration > 25.1) {
    throw new Error('Presentation clip must be 25 seconds');
  }
  if (!Number.isInteger(video.width) || !Number.isInteger(video.height)
    || video.width < 390 || video.height < 800) {
    throw new Error('Presentation clip dimensions are invalid');
  }
  return { seconds: duration, width: video.width, height: video.height };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.stderr?.slice(-2000)}`);
  }
  return result.stdout;
}

export function exportPresentationClip(input, output) {
  // Keep the final 25 seconds of real frames. Never pad, loop or synthesize scenes.
  run('ffmpeg', ['-y', '-sseof', '-25', '-i', input, '-t', '25', '-an',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', output]);
  return validateClipProbe(JSON.parse(run('ffprobe', ['-v', 'error', '-show_format',
    '-show_streams', '-of', 'json', output])));
}
