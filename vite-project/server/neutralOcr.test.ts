import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { recognizeNeutralCounters } from './neutralRecognition.js';

test('objective OCR validates dimensions, rejects blank evidence and never caches repeated input', async () => {
  const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: 'black' } })
    .png()
    .toBuffer();
  const image = 'data:image/png;base64,' + png.toString('base64');
  const regions = [
    { id: 'tyrant', side: 'blue', region: { x: 0.1, y: 0.1, width: 30 / 1920, height: 30 / 1080 } },
  ];
  let calls = 0;
  const provider = {
    recognizeNumbers: async () => {
      calls++;
      return { texts: ['1'], confidences: [0.99], elapsedMs: 1 };
    },
  };
  const clock = { key: 'gameTimeSeconds' as const, value: 120, text: '02:00', confidence: 0.99 };
  const first = await recognizeNeutralCounters(
    { regions, images: [image] },
    provider,
    clock,
    1000,
    'adb',
    image,
  );
  const repeated = await recognizeNeutralCounters(
    { regions, images: [image] },
    provider,
    clock,
    2000,
    'adb',
    image,
  );
  const jitter = await recognizeNeutralCounters(
    { regions, images: [image] },
    provider,
    { ...clock, value: 121, text: '02:01' },
    3000,
    'adb',
    image,
  );
  assert.equal(first.frameHash, jitter.frameHash);
  assert.equal(calls, 3);
  assert.equal(first.frameHash, repeated.frameHash);
  assert.equal(first.candidates[0].value, null);
  assert.equal(first.candidates[0].confidence, 0);
  await assert.rejects(
    recognizeNeutralCounters(
      { regions: [...regions, ...regions], images: [image, image] },
      provider,
      clock,
      2000,
      'adb',
      image,
    ),
    /calibration/,
  );
  await assert.rejects(
    recognizeNeutralCounters(
      {
        regions: [{ ...regions[0], region: { ...regions[0].region, width: 0.1 } }],
        images: [image],
      },
      provider,
      clock,
      2000,
      'adb',
      image,
    ),
    /dimensions/,
  );
  assert.equal(calls, 3);
  await assert.rejects(
    recognizeNeutralCounters(
      { regions: [regions[0], { ...regions[0], id: 'overlord' }], images: [image, image] },
      provider,
      clock,
      2000,
      'adb',
      image,
    ),
    /calibration/,
  );
});
