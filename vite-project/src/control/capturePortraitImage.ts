import { regionToPixels, type NormalizedCaptureRegion } from './windowCaptureGeometry';

export function capturePortraitImage(
  video: HTMLCanvasElement | HTMLVideoElement,
  region: NormalizedCaptureRegion,
  format: 'png' | 'jpeg' = 'png',
) {
  const pixels = regionToPixels(
    region,
    'videoWidth' in video ? video.videoWidth : video.width,
    'videoHeight' in video ? video.videoHeight : video.height,
  );
  const maxSide = format === 'jpeg' ? 256 : 384;
  const minSide = format === 'jpeg' ? 32 : 1;
  const scale = Math.min(1, maxSide / Math.max(pixels.width, pixels.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(minSide, Math.round(pixels.width * scale));
  canvas.height = Math.max(minSide, Math.round(pixels.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    video,
    pixels.x,
    pixels.y,
    pixels.width,
    pixels.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return format === 'jpeg' ? canvas.toDataURL('image/jpeg', 0.94) : canvas.toDataURL('image/png');
}
