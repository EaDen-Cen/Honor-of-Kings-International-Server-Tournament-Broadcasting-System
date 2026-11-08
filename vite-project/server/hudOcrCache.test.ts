import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeHudNumbers } from './hudOcrCache.js';

test('blank and weak first reads are retried on identical crops', async () => {
  for (const first of [
    { text: '', confidence: 0.99 },
    { text: '9', confidence: 0.4 },
    { text: 'CONTROL', confidence: 0.99 },
  ]) {
    let calls = 0;
    const provider = {
      recognizeNumbers: async () => {
        calls++;
        return {
          texts: [calls === 1 ? first.text : '1'],
          confidences: [calls === 1 ? first.confidence : 0.99],
          elapsedMs: 1,
        };
      },
    };
    const valid = (text: string) => /^\d+$/.test(text);
    await recognizeHudNumbers(['same-crop'], provider, 'game-source-profile', Date.now, valid);
    const next = await recognizeHudNumbers(
      ['same-crop'],
      provider,
      'game-source-profile',
      Date.now,
      valid,
    );
    assert.equal(calls, 2, 'failed OCR must not occupy the four-second cache');
    assert.equal(next.texts[0], '1');
  }
});
test('unchanged HUD crops reuse OCR and changed regions remain one batch', async () => {
  const batches: string[][] = [];
  const provider = {
    recognizeNumbers: async (images: unknown) => {
      const values = images as string[];
      batches.push(values);
      return { texts: values, confidences: values.map(() => 0.9), elapsedMs: 1 };
    },
  };
  await recognizeHudNumbers(['a', 'b', 'c'], provider, 'game-1');
  assert.deepEqual((await recognizeHudNumbers(['a', 'B', 'C'], provider, 'game-1')).texts, [
    'a',
    'B',
    'C',
  ]);
  assert.deepEqual(batches, [
    ['a', 'b', 'c'],
    ['B', 'C'],
  ]);
  await recognizeHudNumbers(['a', 'B', 'C'], provider, 'game-2');
  assert.equal(batches.length, 3);
});

test('overlapping frames keep their own reused fields while OCR is pending', async () => {
  let release!: () => void;
  const provider = {
    recognizeNumbers: async (images: unknown) => {
      const values = images as string[];
      if (values.includes('slow'))
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { texts: values, confidences: values.map(() => 0.9), elapsedMs: 1 };
    },
  };
  await recognizeHudNumbers(['a', 'b'], provider, 'same');
  const pending = recognizeHudNumbers(['a', 'slow'], provider, 'same');
  assert.deepEqual((await recognizeHudNumbers(['A', 'b'], provider, 'same')).texts, ['A', 'b']);
  release();
  assert.deepEqual((await pending).texts, ['a', 'slow']);
});
