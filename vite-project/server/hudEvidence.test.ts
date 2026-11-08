import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recognizeHudNumbers } from './hudOcrCache.js';
import {
  initialLiveGameStats,
  trustedLiveUpdates,
  type LiveHudSample,
} from '../src/shared/liveGame.js';
import { liveCaptureKeys } from '../src/shared/gameCapture.js';

const sample = (time: number, hash: string): LiveHudSample => ({
  capturedAt: time,
  frameHash: hash.repeat(64),
  profile: 'game/source/calibration',
  candidates: liveCaptureKeys.map((key) => ({
    key,
    value: key === 'gameTimeSeconds' ? null : key.endsWith('Gold') ? 3000 : 1,
    confidence: 0.99,
    text: '',
    evidenceId: randomUUID(),
  })),
});
test('obscured clock retains trusted time while independently read clear fields update', () => {
  const stats = { ...initialLiveGameStats(), gameTimeSeconds: 120 };
  const first = sample(1000, 'a'),
    next = sample(2000, 'b');
  assert.deepEqual(trustedLiveUpdates(stats, first, next), {
    blueKills: 1,
    redKills: 1,
    blueGold: 3000,
    redGold: 3000,
    blueTowers: 1,
    redTowers: 1,
  });
  assert.equal(stats.gameTimeSeconds, 120);
  next.frameHash = first.frameHash;
  assert.deepEqual(
    trustedLiveUpdates(stats, first, next),
    {},
    'same frozen image cannot be two observations',
  );
  next.frameHash = 'b'.repeat(64);
  next.candidates = next.candidates.map((c, i) => ({
    ...c,
    evidenceId: first.candidates[i].evidenceId,
  }));
  assert.deepEqual(trustedLiveUpdates(stats, first, next), {}, 'cache hit cannot confirm itself');
});
test('new clock frames recover; manual locks survive and source/calibration changes isolate evidence', () => {
  const stats = initialLiveGameStats();
  stats.sources = { blueKills: { source: 'manual', capturedAt: 500, confidence: 1 } };
  stats.blueKills = 9;
  const first = sample(1000, 'a'),
    next = sample(2000, 'b');
  first.candidates[6].value = 120;
  next.candidates[6].value = 121;
  assert.equal(trustedLiveUpdates(stats, first, next).gameTimeSeconds, 121);
  assert.equal(trustedLiveUpdates(stats, first, next).blueKills, undefined);
  next.profile = 'new-game';
  assert.deepEqual(trustedLiveUpdates(stats, first, next), {});
  next.profile = 'new-source';
  assert.deepEqual(trustedLiveUpdates(stats, first, next), {});
  next.profile = 'new-calibration';
  assert.deepEqual(trustedLiveUpdates(stats, first, next), {});
});
test('cache evidence identifiers survive hits but change on game/source/recalibration', async () => {
  let calls = 0;
  const provider = {
    recognizeNumbers: async () => {
      calls++;
      return { texts: ['1'], confidences: [0.99], elapsedMs: 1 };
    },
  };
  const first = await recognizeHudNumbers(['pixels'], provider, 'g1/adb/roi1');
  const hit = await recognizeHudNumbers(['pixels'], provider, 'g1/adb/roi1');
  assert.deepEqual(hit.evidenceIds, first.evidenceIds);
  assert.equal(calls, 1);
  for (const context of ['g2/adb/roi1', 'g2/window/roi1', 'g2/window/roi2']) {
    const changed = await recognizeHudNumbers(['pixels'], provider, context);
    assert.notDeepEqual(changed.evidenceIds, first.evidenceIds);
  }
  assert.equal(calls, 4);
});
