import {
  liveCaptureKeys,
  pixelRect,
  type CaptureRect,
  type LiveCaptureKey,
} from '../shared/gameCapture';

/** Keep small samples, loopback requests and older servers on the JSON path. */
export async function hudRequestBody(input: unknown, acceptsGzip: boolean, endpoint: URL) {
  const json = JSON.stringify(input);
  if (
    !acceptsGzip ||
    json.length < 8192 ||
    /^(?:localhost\.?|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(endpoint.hostname) ||
    typeof CompressionStream !== 'function'
  )
    return json;
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).blob();
    return compressed.size < json.length ? compressed : json;
  } catch {
    return json;
  }
}

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
