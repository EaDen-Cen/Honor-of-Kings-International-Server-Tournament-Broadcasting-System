import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePostGameReport, applyPostGameAction } from './postGameActions.js';
import {
  initialState,
  type GameDraftRecord,
  type GameRules,
  type MatchState,
} from '../src/shared/types.js';
import { isMatchSnapshot } from '../src/shared/matchProtocol.js';
import { seriesName, phaseName } from '../src/shared/display.js';
import { archiveData, restoreArchive } from './recovery.js';
import { Store } from './store.js';
import { heroesForPool } from '../src/shared/heroPool.js';
import { phases } from '../src/shared/types.js';
import type { Action, SeriesFormat } from '../src/shared/types.js';

const act = (store: Store, action: Action) =>
  store.apply(randomUUID(), store.data.revision, action);
function blindStore(format: SeriesFormat = 'BO7') {
  const store = new Store();
  act(store, {
    type: 'series_rules',
    seriesFormat: format,
    rules: { defaultGameRules: blindRules(), games: {} },
  });
  return store;
}

const blindRules = (): GameRules => ({
  mode: 'blind',
  heroPool: 'global',
  banCount: 0,
  draftRuleMode: 'global',
  enforcePreviousHistory: false,
  contributeToFutureHistory: false,
  recordHeroes: false,
  requireLineupConfirmation: false,
  firstPickSide: 'blue',
  sideSwapMode: 'moveTeams',
  flowbornFormsIndependent: true,
});
function blindSeries() {
  const state: MatchState = {
    ...initialState(),
    seriesFormat: 'BO7',
    draftMode: 'blind',
    banCount: 0,
    currentGameRules: blindRules(),
    seriesRules: { defaultGameRules: blindRules(), games: {} },
    gameNumber: 7,
    draftGameNumber: 7,
    blueScore: 3,
    redScore: 3,
  };
  for (const side of ['blue', 'red'] as const)
    state[`${side}Team`].players = Array.from({ length: 5 }, (_, i) => `${side}-${i}`);
  for (let gameNumber = 1; gameNumber <= 7; gameNumber++) {
    const game: GameDraftRecord = {
      id: randomUUID(),
      gameNumber,
      committedAt: gameNumber,
      rules: blindRules(),
      firstPickSide: 'blue',
      heroPool: 'global',
      banCount: 0,
      blueTeam: structuredClone(state.blueTeam),
      redTeam: structuredClone(state.redTeam),
      bluePicks: [],
      redPicks: [],
      blueBans: [],
      redBans: [],
      blueAssignments: [],
      redAssignments: [],
    };
    state.draftHistory.push(game);
    preparePostGameReport(state, game);
  }
  state.committedGameId = state.draftHistory[6].id;
  state.activePostGameReportId = state.committedGameId;
  return state;
}
test('seven blind reports retain ten real players, stable game IDs and independent numeric data', () => {
  const state = blindSeries();
  assert.equal(state.postGameReports.length, 7);
  for (const report of state.postGameReports) {
    assert.equal(report.seriesFormat, 'BO7');
    assert.equal(report.players.length, 10);
    assert.equal(new Set(report.players.map((p) => p.rowId)).size, 10);
    assert.ok(report.players.every((p) => p.heroId === null));
    applyPostGameAction(state, {
      type: 'post_game_fields',
      reportId: report.id,
      updates: [
        {
          rowId: report.players[0].rowId,
          metric: 'kills',
          field: { value: report.gameNumber, confidence: 1, manual: true, sourcePage: 'record' },
        },
      ],
    });
    preparePostGameReport(state, state.draftHistory.find((game) => game.id === report.id)!);
  }
  assert.deepEqual(
    state.postGameReports.map((r) => r.players[0].fields.kills?.value),
    [1, 2, 3, 4, 5, 6, 7],
  );
  applyPostGameAction(state, {
    type: 'select_mvp',
    reportId: state.committedGameId!,
    rowId: state.postGameReports[6].players[0].rowId,
  });
  assert.ok(isMatchSnapshot({ type: 'match_state_update', revision: 1, state }));
  assert.equal(seriesName('BO7', 'eng'), 'Best of 7');
  assert.equal(phaseName(state, 'eng'), 'Blind Pick');
});
test('BO7 blind report backup restores all game snapshots and null hero evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'hok-bo7-report-'));
  const file = join(root, 'match.json'),
    uploads = join(root, 'uploads');
  try {
    mkdirSync(uploads);
    const store = new Store(file);
    store.data.state = blindSeries();
    store.apply(randomUUID(), store.data.revision, { type: 'delay', seconds: 0 });
    const archive = archiveData(file, uploads, false);
    restoreArchive(archive, file, uploads);
    const restored = new Store(file).data.state;
    assert.equal(restored.seriesFormat, 'BO7');
    assert.equal(restored.draftHistory.length, 7);
    assert.equal(restored.postGameReports.length, 7);
    assert.ok(
      restored.postGameReports.every(
        (r) => r.players.length === 10 && r.players.every((p) => p.heroId === null),
      ),
    );
    assert.ok(
      restored.draftHistory.every(
        (g) => g.rules?.recordHeroes === false && g.bluePicks.length === 0,
      ),
    );
    assert.equal(restored.seriesRules?.defaultGameRules.mode, 'blind');
    assert.equal(restored.currentGameRules?.mode, 'blind');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('protocol rejects malformed per-game rules rather than rendering mismatched snapshots', () => {
  const state = blindSeries();
  state.currentGameRules!.banCount = 9 as GameRules['banCount'];
  assert.equal(isMatchSnapshot({ type: 'match_state_update', revision: 1, state }), false);
});

test('optional blind lineups survive backup without fabricating traditional draft picks', () => {
  const root = mkdtempSync(join(tmpdir(), 'hok-blind-lineup-'));
  const file = join(root, 'match.json'),
    uploads = join(root, 'uploads');
  try {
    mkdirSync(uploads);
    const store = new Store(file);
    const rules = { ...blindRules(), recordHeroes: true, contributeToFutureHistory: true };
    store.apply(randomUUID(), store.data.revision, {
      type: 'series_rules',
      seriesFormat: 'BO7',
      rules: { defaultGameRules: rules, games: {} },
    });
    store.apply(randomUUID(), store.data.revision, { type: 'start_blind_game' });
    const heroId = heroesForPool('global')[0].id;
    store.apply(randomUUID(), store.data.revision, {
      type: 'blind_lineup',
      blue: [heroId, null, null, null, null],
      red: [null, null, null, null, null],
    });
    restoreArchive(archiveData(file, uploads, false), file, uploads);
    const restored = new Store(file).data.state;
    assert.deepEqual(restored.bluePicks, []);
    assert.deepEqual(restored.draftHistory[0].bluePicks, []);
    assert.deepEqual(restored.draftHistory[0].blueAssignments, [heroId, null, null, null, null]);
    assert.deepEqual(
      restored.postGameReports[0].players.map((row) => row.heroId),
      [heroId, null, null, null, null, null, null, null, null, null],
    );
    assert.ok(isMatchSnapshot(store.snapshot('control')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('delayed caster keeps the earlier game rules when the live game switches to blind pick', () => {
  const store = new Store(undefined, () => 400_000);
  const earlierRules = {
    ...blindRules(),
    mode: 'match' as const,
    banCount: 5 as const,
    recordHeroes: true,
    contributeToFutureHistory: true,
  };
  const earlier = {
    ...initialState(),
    seriesFormat: 'BO7' as const,
    banCount: 5 as const,
    currentPhase: 3,
    draftGameNumber: 1,
    currentGameRules: earlierRules,
    seriesRules: { defaultGameRules: earlierRules, games: { '2': blindRules() } },
  };
  store.data.state = {
    ...earlier,
    draftMode: 'blind',
    banCount: 0,
    currentPhase: 0,
    gameNumber: 2,
    draftGameNumber: null,
    currentGameRules: blindRules(),
  };
  store.data.events = [
    {
      id: randomUUID(),
      timestamp: 100_000,
      type: 'draft_action',
      revision: 1,
      resultingState: earlier,
    },
  ];
  const delayed = store.snapshot('caster');
  assert.equal(delayed.state.draftGameNumber, 1);
  assert.equal(delayed.state.draftMode, 'match');
  assert.equal(delayed.state.currentGameRules?.banCount, 5);
  assert.equal(
    phases(delayed.state.draftMode, delayed.state.firstPickSide, delayed.state.banCount).length,
    20,
  );
  assert.ok(isMatchSnapshot(delayed));
  assert.equal(store.snapshot('overlay').state.draftMode, 'blind');
});

test('finished BO5 cannot reopen by changing format, while an unfinished BO5 can extend', () => {
  const store = blindStore('BO5');
  for (let game = 1; game <= 5; game++) {
    act(store, { type: 'start_blind_game' });
    const winner = game % 2 ? 'blue' : 'red';
    act(store, { type: 'confirm_game_end', reportId: store.data.state.committedGameId!, winner });
    act(store, { type: 'score', team: winner, delta: 1 });
    if (game < 5) act(store, { type: 'next_game' });
  }
  const before = structuredClone(store.data);
  assert.throws(
    () =>
      act(store, {
        type: 'series_rules',
        seriesFormat: 'BO7',
        rules: store.data.state.seriesRules!,
      }),
    /finished series/,
  );
  assert.throws(
    () => act(store, { type: 'settings', settings: { ...store.data.state, seriesFormat: 'BO7' } }),
    /finished series/,
  );
  assert.deepEqual(store.data, before);

  const unfinished = blindStore('BO5');
  act(unfinished, { type: 'start_blind_game' });
  act(unfinished, { type: 'score', team: 'blue', delta: 1 });
  act(unfinished, {
    type: 'series_rules',
    seriesFormat: 'BO7',
    rules: unfinished.data.state.seriesRules!,
  });
  act(unfinished, { type: 'next_game' });
  assert.equal(unfinished.data.state.gameNumber, 2);
  assert.equal(unfinished.data.state.seriesFormat, 'BO7');
});

test('committed blind games lock every active rule even though their phase remains zero', () => {
  const store = blindStore();
  act(store, { type: 'start_blind_game' });
  assert.equal(store.data.state.currentPhase, 0);
  const before = structuredClone(store.data);
  for (const change of [
    { draftMode: 'normal' as const },
    { firstPickSide: 'red' as const },
    { sideSwapMode: 'colorsOnly' as const },
    { heroPool: 'cn' as const },
    { banCount: 1 as const },
    { draftRuleMode: 'player' as const },
    { flowbornFormsIndependent: false },
  ]) {
    assert.throws(
      () => act(store, { type: 'settings', settings: { ...store.data.state, ...change } }),
      /rulesLocked/,
    );
    assert.deepEqual(store.data, before);
  }
  act(store, { type: 'settings', settings: { ...store.data.state, stage: 'Final' } });
  assert.equal(store.data.state.stage, 'Final');
  assert.deepEqual(store.data.state.currentGameRules, before.state.currentGameRules);
  const drafting = new Store();
  act(drafting, { type: 'skip_ban', team: 'blue' });
  const active = structuredClone(drafting.data);
  assert.throws(
    () =>
      act(drafting, {
        type: 'settings',
        settings: { ...drafting.data.state, sideSwapMode: 'colorsOnly' },
      }),
    /rulesLocked/,
  );
  assert.deepEqual(drafting.data, active);
});

test('unrecorded blind games keep empty historic assignments after rejected live and historic edits', () => {
  const store = blindStore();
  act(store, { type: 'start_blind_game' });
  const gameId = store.data.state.committedGameId!;
  const before = structuredClone(store.data);
  assert.throws(
    () => act(store, { type: 'swap_assignments', team: 'blue', from: 0, to: 1 }),
    /does not record/,
  );
  assert.throws(() =>
    act(store, { type: 'set_lineup_assignments', blue: [1, 2, 3, 4, 5], red: [6, 7, 8, 9, 10] }),
  );
  assert.throws(() =>
    act(store, {
      type: 'blind_lineup',
      blue: [null, null, null, null, null],
      red: [null, null, null, null, null],
    }),
  );
  assert.deepEqual(store.data, before);
  act(store, {
    type: 'set_game_roles',
    side: 'blue',
    roles: ['jungle', 'clash', 'mid', 'farm', 'roam'],
  });
  assert.deepEqual(store.data.state.draftHistory[0].blueAssignments, []);
  assert.ok(store.data.state.postGameReports[0].players.every((row) => row.heroId === null));
  act(store, { type: 'score', team: 'blue', delta: 1 });
  act(store, { type: 'next_game' });
  const later = structuredClone(store.data);
  assert.throws(
    () => act(store, { type: 'swap_assignments', gameId, team: 'blue', from: 0, to: 1 }),
    /does not record/,
  );
  assert.deepEqual(store.data, later);
  assert.ok(isMatchSnapshot(store.snapshot('control')));
});
