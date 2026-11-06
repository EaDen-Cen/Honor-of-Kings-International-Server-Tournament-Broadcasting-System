import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PlayerRecognitionProvider } from './playerRecognition.js';
import { recognizeLiveHudCrops } from './gameDataRecognition.js';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture.js';

test('real LDPlayer 11.2k gold retains its suffix within the default crop', async () => {
  const digit = await readFile(new URL('./fixtures/ghud-blue-gold-11k.png', import.meta.url));
  const images = await Promise.all(
    liveCaptureKeys.map(async (key) => {
      const bounds = pixelRect(liveCaptureRects[key], 1920, 1080);
      const buffer =
        key === 'blueGold'
          ? await sharp(digit)
              .extract({ left: 0, top: 0, width: bounds.width, height: bounds.height })
              .png()
              .toBuffer()
          : await sharp({
              create: {
                width: bounds.width,
                height: bounds.height,
                channels: 3,
                background: 'black',
              },
            })
              .png()
              .toBuffer();
      return 'data:image/png;base64,' + buffer.toString('base64');
    }),
  );
  const provider = new PlayerRecognitionProvider(undefined, 'eng');
  try {
    await provider.prepare();
    await provider.prepareNumbers();
    const result = await recognizeLiveHudCrops(images, provider, liveCaptureRects);
    const gold = result.candidates.find((c) => c.key === 'blueGold')!;
    assert.equal(gold.value, 11200);
    assert.ok(gold.confidence >= 0.85);
  } finally {
    await provider.close();
  }
});
