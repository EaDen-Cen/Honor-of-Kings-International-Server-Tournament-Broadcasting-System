import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { pixelRect, type LiveCandidate } from '../src/shared/gameCapture.js';
import { validNeutralRegions, type NeutralSample } from '../src/shared/neutralRecognition.js';
import type { PlayerRecognitionProvider } from './playerRecognition.js';

/** Absolute visible counters only. Independent OCR; no banner counting or cached candidates. */
export async function recognizeNeutralCounters(
  input: unknown,
  provider: Pick<PlayerRecognitionProvider, 'recognizeNumbers'>,
  clock: LiveCandidate,
  capturedAt: number,
  sourceProfile: string,
  clockImage: string,
): Promise<NeutralSample> {
  if (!input || typeof input !== 'object') throw Error('Invalid objective crops');
  const { regions, images } = input as { regions: unknown; images: unknown };
  if (!validNeutralRegions(regions) || !Array.isArray(images) || images.length !== regions.length)
    throw Error('Invalid objective calibration');
  const hash = createHash('sha256');
  const blank: boolean[] = [];
  const crops = await Promise.all(
    images.map(async (image, index) => {
      if (
        typeof image !== 'string' ||
        image.length > 180000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)
      )
        throw Error('Invalid objective crop image');
      const buffer = Buffer.from(image.split(',')[1], 'base64');
      const metadata = await sharp(buffer, { limitInputPixels: 100000 }).metadata(),
        expected = pixelRect(regions[index].region, 1920, 1080);
      if (
        metadata.format !== 'png' ||
        metadata.width !== expected.width ||
        metadata.height !== expected.height
      )
        throw Error('Objective crop dimensions do not match calibration');
      const decoded = await sharp(buffer).removeAlpha().raw().toBuffer();
      const stats = await sharp(buffer).stats();
      blank[index] = stats.channels.every((channel) => channel.stdev < 5);
      return { image, decoded };
    }),
  );
  for (const crop of crops) hash.update(crop.decoded);
  if (
    typeof clockImage !== 'string' ||
    clockImage.length > 180000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(clockImage)
  )
    throw Error('Invalid clock crop image');
  // OCR text jitter must not turn identical pixels into independent evidence.
  hash.update(
    await sharp(Buffer.from(clockImage.split(',')[1], 'base64'), { limitInputPixels: 100000 })
      .removeAlpha()
      .raw()
      .toBuffer(),
  );
  const result = await provider.recognizeNumbers(crops.map((c) => c.image));
  return {
    capturedAt,
    profile: JSON.stringify([sourceProfile, regions]),
    frameHash: hash.digest('hex'),
    clock: { value: clock.value, confidence: clock.confidence },
    candidates: regions.map((r, i) => {
      const text = result.texts[i]?.normalize('NFKC').trim() ?? '';
      return {
        id: r.id,
        side: r.side,
        value: !blank[i] && /^\d{1,2}$/.test(text) ? Number(text) : null,
        confidence: blank[i] ? 0 : (result.confidences[i] ?? 0),
      };
    }),
  };
}
