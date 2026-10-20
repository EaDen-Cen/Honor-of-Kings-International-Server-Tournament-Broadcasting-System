import {
  liveCaptureKeys,
  pixelRect,
  type CaptureRect,
  type LiveCaptureKey,
} from '../shared/gameCapture';

/** Lossless, ordered crops from one frame. The server checks each crop against
 * the calibration before OCR; a field can never drift into another HUD slot. */
export function captureHudImages(
  frame: HTMLCanvasElement,
  regions: Record<LiveCaptureKey, CaptureRect>,
) {
  return liveCaptureKeys.map((key) => {
    const bounds = pixelRect(regions[key], 1920, 1080);
    const canvas = document.createElement('canvas');
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(
      frame,
      bounds.left,
      bounds.top,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );
    return canvas.toDataURL('image/png');
  });
}
