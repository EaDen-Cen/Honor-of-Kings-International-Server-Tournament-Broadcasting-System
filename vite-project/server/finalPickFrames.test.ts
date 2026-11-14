import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyFinalSlot, sameFinalPickPixels } from '../src/control/finalPickFrames.js';

test('two final-pick reads can share recognition only for identical pixels in every portrait and lock region', () => {
  const regions = [
    { x: 0, y: 0, width: 0.2, height: 0.5 },
    { x: 0.7, y: 0, width: 0.2, height: 0.5 },
  ];
  const frame = (changedX: number, changedY: number) =>
    ({
      width: 100,
      height: 100,
      getContext: () => ({
        getImageData: (x: number, y: number, width: number, height: number) => {
          const data = new Uint8ClampedArray(width * height * 4);
          if (changedX >= x && changedX < x + width && changedY >= y && changedY < y + height)
            data[((changedY - y) * width + changedX - x) * 4] = 1;
          return { data };
        },
      }),
    }) as unknown as HTMLCanvasElement;
  const first = frame(-1, -1);
  assert.equal(emptyFinalSlot(first, regions[0]), true);
  assert.equal(emptyFinalSlot(frame(4, 25), regions[0]), false);
  assert.equal(sameFinalPickPixels(first, frame(50, 25), regions), true);
  assert.equal(sameFinalPickPixels(first, frame(4, 25), regions), false);
  assert.equal(sameFinalPickPixels(first, frame(80, 61), regions), false);
});
