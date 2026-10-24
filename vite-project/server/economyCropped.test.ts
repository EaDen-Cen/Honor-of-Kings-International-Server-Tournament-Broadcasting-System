import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PlayerRecognitionProvider } from './playerRecognition.js';
import { recognizeSettlementGoldCurve } from './settlementGoldCurve.js';
test('2026-10-23 real cropped economy chart reads signed scale and final 11:15 anchor', async () => {
  const provider = new PlayerRecognitionProvider();
  try {
    await provider.prepare();
    const result = await recognizeSettlementGoldCurve(
      await readFile(new URL('./fixtures/economy-curve-cropped-20261023.png', import.meta.url)),
      provider,
    );
    assert.equal(result.error, undefined);
    assert.equal(result.maxDifference, 9200);
    assert.equal(result.points.length, 12);
    assert.equal(result.points[0].timeSeconds, 0);
    assert.equal(result.durationSeconds, 675);
    assert.equal(result.points.at(-1)?.timeSeconds, 675);
    assert.ok(Math.abs(result.points.at(-1)!.difference + 9200) < 250);
    assert.ok(result.points.every((p) => p.difference <= 100));
  } finally {
    await provider.close();
  }
});
