import assert from 'node:assert/strict';
import test from 'node:test';
import { nextLiveGameStats, type LiveGameStats } from '../src/shared/liveGame.js';
import {
  manualNeutralObjectives,
  trustedNeutralUpdates,
  validateNeutralSample,
  type NeutralSample,
} from '../src/shared/neutralRecognition.js';

const stats = (): LiveGameStats => ({
  blueKills: 0,
  redKills: 0,
  blueTowers: 0,
  redTowers: 0,
  density: 'full',
  gameTimeSeconds: 100,
  neutralObjectives: [
    {
      id: 'tyrant',
      name: 'Tyrant',
      icon: 'dragon',
      blue: 0,
      red: 0,
      status: 'alive',
      countFrozen: { blue: false },
    },
  ],
});
const sample = (capturedAt: number, clock: number, hash: string): NeutralSample => ({
  capturedAt,
  profile: 'calibrated-counter',
  frameHash: hash.repeat(64),
  clock: { value: clock, confidence: 0.99 },
  candidates: [{ id: 'tyrant', side: 'blue', value: 1, confidence: 0.99 }],
});

test('absolute counters require independent progressing frames and explicit resume', () => {
  const before = sample(1000, 100, 'a'),
    after = sample(2000, 101, 'b');
  assert.equal(trustedNeutralUpdates(stats(), before, after).length, 1);
  for (const changed of [
    { ...after, frameHash: before.frameHash },
    { ...after, profile: 'other source' },
    { ...after, clock: before.clock },
    { ...after, clock: { value: 101, confidence: 0.84 } },
    { ...after, candidates: [{ ...after.candidates[0], value: 2 }] },
  ])
    assert.deepEqual(trustedNeutralUpdates(stats(), before, changed), []);
  const frozen = stats();
  delete frozen.neutralObjectives[0].countFrozen;
  assert.deepEqual(trustedNeutralUpdates(frozen, before, after), []);
  frozen.neutralObjectives[0].countFrozen = { blue: false };
  frozen.neutralObjectives[0].countEpoch = { blue: 1000 };
  assert.deepEqual(trustedNeutralUpdates(frozen, before, after), []);
});

test('manual counters freeze without altering presence; new games clear provenance', () => {
  const initial = stats();
  const edited = manualNeutralObjectives(
    initial.neutralObjectives,
    [{ ...initial.neutralObjectives[0], blue: 2 }],
    1500,
  );
  assert.equal(edited[0].status, 'alive');
  assert.equal(edited[0].countFrozen?.blue, true);
  assert.equal(edited[0].countSources?.blue?.source, 'manual');
  assert.deepEqual(
    trustedNeutralUpdates(
      { ...initial, neutralObjectives: edited },
      sample(2000, 101, 'a'),
      sample(3000, 102, 'b'),
    ),
    [],
  );
  const next = nextLiveGameStats({ ...initial, neutralObjectives: edited });
  assert.equal(next.neutralObjectives[0].blue, 0);
  assert.equal(next.neutralObjectives[0].countSources, undefined);
  assert.equal(edited[0].blue, 2);
});

test('sample validation rejects expired, duplicate and malformed evidence', () => {
  const valid = sample(2000, 101, 'b');
  assert.doesNotThrow(() => validateNeutralSample(valid, 3000));
  for (const invalid of [
    { ...valid, capturedAt: 40000 },
    { ...valid, capturedAt: 0 },
    { ...valid, frameHash: 'cached' },
    { ...valid, candidates: [...valid.candidates, ...valid.candidates] },
    { ...valid, candidates: [{ ...valid.candidates[0], value: -1 }] },
  ])
    assert.throws(() => validateNeutralSample(invalid, 30001));
});
