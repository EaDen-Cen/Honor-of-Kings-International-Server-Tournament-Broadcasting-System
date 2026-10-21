import { createHash } from 'node:crypto';
import type { PlayerRecognitionProvider } from './playerRecognition.js';
type Provider = Pick<PlayerRecognitionProvider, 'recognizeNumbers'>;
let caches = new WeakMap<
  Provider,
  {
    context: string;
    fields: Map<number, { key: string; text: string; confidence: number; until: number }>;
  }
>();
/** Reuse only identical, already validated crops for at most four seconds.
 * Cache is per OCR provider + authoritative game/epoch + calibration; changing
 * games, worker instances or regions cannot reuse old samples.
 * All changed fields remain a single OCR batch. A moving clock still needs a
 * fresh read, so the existing two-sample publication gate remains meaningful.
 */
export async function recognizeHudNumbers(images: string[], provider: Provider, context?: string) {
  if (context === undefined) return provider.recognizeNumbers(images);
  let cache = caches.get(provider);
  if (!cache || cache.context !== context) {
    cache = { context, fields: new Map() };
    caches.set(provider, cache);
  }
  const keys = images.map((image) => createHash('sha256').update(image).digest('hex'));
  const now = Date.now();
  // Snapshot reused fields before awaiting OCR: another in-flight frame may
  // update the shared cache while this frame's changed regions are being read.
  const samples = keys.map((key, index) => {
    const prior = cache.fields.get(index);
    return prior?.key === key && prior.until > now ? prior : undefined;
  });
  const changed = keys.flatMap((_, index) => {
    return samples[index] ? [] : [index];
  });
  if (changed.length) {
    const result = await provider.recognizeNumbers(changed.map((index) => images[index]));
    changed.forEach((index, offset) => {
      const sample = {
        key: keys[index],
        text: result.texts[offset],
        confidence: result.confidences[offset],
        until: Date.now() + 4000,
      };
      samples[index] = sample;
      cache.fields.set(index, sample);
    });
  }
  return {
    texts: samples.map((sample) => sample!.text),
    confidences: samples.map((sample) => sample!.confidence),
    elapsedMs: Date.now() - now,
  };
}

export function invalidateHudCache() {
  caches = new WeakMap();
}
