import { regionToPixels, type NormalizedCaptureRegion } from './windowCaptureGeometry.js';

export function lockRegion(region: NormalizedCaptureRegion) {
  return { ...region, height: Math.min(1 - region.y, region.height * 1.3) };
}

/** A solid rectangle has no portrait details to identify, regardless of its colour. */
export function emptyFinalSlot(frame: HTMLCanvasElement, region: NormalizedCaptureRegion) {
  const context = frame.getContext('2d');
  if (!context) return false;
  const { x, y, width, height } = regionToPixels(region, frame.width, frame.height);
  const pixels = new Uint32Array(context.getImageData(x, y, width, height).data.buffer);
  for (let i = 1; i < pixels.length; i++) {
    if (pixels[i] !== pixels[0]) return false;
  }
  return true;
}

// Compare the source pixels, including the extension below each portrait where the lock is drawn.
export function sameFinalPickPixels(
  first: HTMLCanvasElement,
  next: HTMLCanvasElement,
  regions: readonly NormalizedCaptureRegion[],
) {
  if (first.width !== next.width || first.height !== next.height) return false;
  const a = first.getContext('2d');
  const b = next.getContext('2d');
  if (!a || !b) return false;
  return regions.every((region) => {
    const { x, y, width, height } = regionToPixels(lockRegion(region), first.width, first.height);
    const left = new Uint32Array(a.getImageData(x, y, width, height).data.buffer);
    const right = new Uint32Array(b.getImageData(x, y, width, height).data.buffer);
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  });
}
