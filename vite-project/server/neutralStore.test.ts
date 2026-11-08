import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { liveGameContext, type LiveHudSample } from '../src/shared/liveGame.js';
import { liveCaptureKeys } from '../src/shared/gameCapture.js';
import type { NeutralSample } from '../src/shared/neutralRecognition.js';
import { phases, type Action } from '../src/shared/types.js';
import heroes from '../src/components/HeroList.js';

const sample = (at: number, clock: number, value = 1): NeutralSample => ({
  capturedAt: at,
  profile: 'adb-counter',
  frameHash: (clock % 2 ? 'a' : 'b').repeat(64),
  clock: { value: clock, confidence: 0.99 },
  candidates: [{ id: 'tyrant', side: 'blue', value, confidence: 0.99 }],
});
test('objective actions preserve manual locks, require fresh evidence after Undo/restart and persist sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hok-neutral-')),
    file = join(dir, 'match.json');
  let now = 1000,
    store = new Store(file, () => now);
  const apply = (action: Action) => store.apply(randomUUID(), store.data.revision, action);
  const context = liveGameContext(store.data.state);
  const objective = () => store.data.state.liveGameStats.neutralObjectives[0];
  const ocr = () =>
    apply({
      type: 'live_objective_ocr',
      context,
      previous: sample(now - 1000, 120),
      sample: sample(now, 121),
    });
  try {
    apply({ type: 'live_objective_freeze', context, id: 'tyrant', side: 'blue', frozen: false });
    now = 4000;
    ocr();
    assert.equal(objective().blue, 1);
    const revision = store.data.revision;
    assert.throws(ocr, /No fresh/);
    assert.equal(store.data.revision, revision);
    apply({ type: 'live_objective_count', context, id: 'tyrant', side: 'blue', value: 1 });
    assert.equal(objective().countFrozen?.blue, true, 'confirming the same number still locks it');
    assert.throws(ocr, /No fresh/);
    apply({ type: 'live_objective_freeze', context, id: 'tyrant', side: 'blue', frozen: false });
    assert.throws(ocr, /No fresh/, 'old evidence cannot survive resume');
    now = 7000;
    ocr();
    apply({ type: 'undo' });
    assert.throws(ocr, /restart or Undo/);
    now = 10000;
    ocr();
    store = new Store(file, () => now);
    assert.equal(objective().countSources?.blue?.source, 'ocr');
    assert.throws(ocr, /restart or Undo/);
    assert.throws(
      () =>
        apply({
          type: 'live_objective_count',
          context: 'old-game',
          id: 'tyrant',
          side: 'blue',
          value: 8,
        }),
      /Game changed/,
    );
    assert.equal(objective().blue, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same-frame HUD and objective publication is atomic and leaves score, presence and team data intact', () => {
  let now = 1000;
  const store = new Store(undefined, () => now),
    context = liveGameContext(store.data.state);
  const apply = (action: Action) => store.apply(randomUUID(), store.data.revision, action);
  apply({ type: 'live_objective_freeze', context, id: 'tyrant', side: 'blue', frozen: false });
  const team = structuredClone(store.data.state.blueTeam),
    revision = store.data.revision;
  const hud = (at: number, time: number): LiveHudSample => ({
    capturedAt: at,
    neutral: sample(at, time),
    candidates: liveCaptureKeys.map((key) => ({
      key,
      value: key === 'gameTimeSeconds' ? time : 0,
      confidence: 0.99,
      text: '',
    })),
  });
  now = 4000;
  apply({ type: 'live_game_ocr', context, previous: hud(3000, 120), sample: hud(4000, 121) });
  assert.equal(store.data.revision, revision + 1);
  assert.equal(store.data.state.liveGameStats.gameTimeSeconds, 121);
  assert.equal(store.data.state.liveGameStats.neutralObjectives[0].blue, 1);
  assert.equal(store.data.state.liveGameStats.neutralObjectives[0].status, 'unknown');
  assert.deepEqual(store.data.state.blueTeam, team);
  assert.equal(store.data.state.blueScore, 0);
});

for (const count of [1, 3, 5] as const)
  test(`BO${count} objective history is retained without leaking counters into the next game`, () => {
    const store = new Store();
    const apply = (action: Action) => store.apply(randomUUID(), store.data.revision, action);
    apply({ type: 'settings', settings: { ...store.data.state, seriesFormat: `BO${count}` } });
    phases('match').forEach((phase, i) =>
      apply({ type: 'draft_action', ...phase, heroId: heroes[i].id }),
    );
    apply({ type: 'commit_game' });
    const context = liveGameContext(store.data.state);
    apply({ type: 'live_objective_count', context, id: 'tyrant', side: 'blue', value: 3 });
    assert.equal(store.data.state.draftHistory[0].liveGameStats?.neutralObjectives[0].blue, 3);
    apply({ type: 'score', team: 'blue', delta: 1 });
    if (count > 1) {
      apply({ type: 'next_game' });
      assert.equal(store.data.state.liveGameStats.neutralObjectives[0].blue, 0);
      assert.equal(store.data.state.liveGameStats.neutralObjectives[0].countSources, undefined);
      apply({
        type: 'live_objective_count',
        context: liveGameContext(store.data.state),
        id: 'tyrant',
        side: 'red',
        value: 2,
      });
      assert.equal(store.data.state.draftHistory[0].liveGameStats?.neutralObjectives[0].red, 0);
      assert.throws(
        () =>
          apply({ type: 'live_objective_count', context, id: 'tyrant', side: 'blue', value: 8 }),
        /Game changed/,
      );
    }
    assert.equal(store.data.state.draftHistory[0].liveGameStats?.neutralObjectives[0].blue, 3);
  });
