import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PlayerRecognitionProvider } from '../server/playerRecognition.js';
import { recognizeLiveHudCrops } from '../server/gameDataRecognition.js';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture.js';

// Use --image path.png for a 16:9 game screenshot and optionally --regions
// regions.json for its seven calibrated normalized rectangles. No match writes.
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const imagePath = option('--image'),
  regionsPath = option('--regions');
const fixture = imagePath
  ? undefined
  : JSON.parse(
      await readFile(
        new URL('../server/fixtures/game-data-screenshots.json', import.meta.url),
        'utf8',
      ),
    );
const frame = await sharp(
  imagePath ? await readFile(imagePath) : Buffer.from(fixture.hud, 'base64'),
)
  .resize(1920, 1080, { fit: 'fill' })
  .png()
  .toBuffer();
const regions = regionsPath ? JSON.parse(await readFile(regionsPath, 'utf8')) : liveCaptureRects;
const images = await Promise.all(
  liveCaptureKeys.map(
    async (key) =>
      'data:image/png;base64,' +
      (
        await sharp(frame)
          .extract(pixelRect(regions[key], 1920, 1080))
          .png()
          .toBuffer()
      ).toString('base64'),
  ),
);
const provider = new PlayerRecognitionProvider(undefined, 'eng');
try {
  const warming = performance.now();
  await provider.prepare();
  await provider.prepareNumbers();
  const warmupMs = performance.now() - warming;
  const timings: number[] = [];
  let result: Awaited<ReturnType<typeof recognizeLiveHudCrops>> | undefined;
  for (let index = 0; index < 6; index++) {
    const start = performance.now();
    result = await recognizeLiveHudCrops(images, provider, regions);
    timings.push(performance.now() - start);
  }
  console.log(
    JSON.stringify(
      {
        modelWarmupMs: Math.round(warmupMs),
        firstReadMs: Math.round(timings[0]),
        medianWarmReadMs: Math.round(timings.slice(1).sort((a, b) => a - b)[2]),
        payloadBytes: Buffer.byteLength(JSON.stringify({ images, regions })),
        candidates: result?.candidates,
      },
      null,
      2,
    ),
  );
} finally {
  await provider.close();
}
