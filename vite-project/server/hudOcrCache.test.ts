import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeHudNumbers } from './hudOcrCache.js';
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

test('low-confidence or blank HUD OCR is retried rather than cached for four seconds', async () => {
  let calls = 0;
  const provider = {
    recognizeNumbers: async (images: unknown) => {
      calls++;
      const items = images as string[];
      return {
        texts: items.map(() => calls === 1 ? '??' : calls === 2 ? '' : '1500'),
        confidences: items.map(() => calls === 1 ? 0.72 : calls === 2 ? 0.99 : 0.96),
        elapsedMs: 1,
      };
    },
  };
  const first = await recognizeHudNumbers(['same-crop'], provider, 'new-game');
  assert.equal(first.confidences[0], 0.72);
  assert.equal((await recognizeHudNumbers(['same-crop'], provider, 'new-game')).texts[0], '');
  assert.equal((await recognizeHudNumbers(['same-crop'], provider, 'new-game')).texts[0], '1500');
  assert.equal((await recognizeHudNumbers(['same-crop'], provider, 'new-game')).texts[0], '1500');
  assert.equal(calls, 3);
});
