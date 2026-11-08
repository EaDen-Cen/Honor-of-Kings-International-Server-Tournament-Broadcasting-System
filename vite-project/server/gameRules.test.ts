import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { archiveData, restoreArchive } from './recovery.js';
import { heroesForPool, heroAllowed } from '../src/shared/heroPool.js';
import {
  phases,
  type Action,
  type GameRules,
  type SeriesRules,
  type Side,
} from '../src/shared/types.js';
import {
  banRestriction,
  draftHeroUsed,
  draftRestriction,
  pickRestriction,
  seriesFinished,
} from '../src/shared/draftRules.js';

const act = (store: Store, action: Action) =>
  store.apply(randomUUID(), store.data.revision, action);
const defaults = (overrides: Partial<GameRules> = {}): GameRules => ({
  mode: 'match',
  heroPool: 'global',
  banCount: 4,
  draftRuleMode: 'global',
  enforcePreviousHistory: true,
  contributeToFutureHistory: true,
  recordHeroes: true,
  requireLineupConfirmation: false,
  firstPickSide: 'blue',
  sideSwapMode: 'moveTeams',
  flowbornFormsIndependent: true,
  ...overrides,
});
function setup(
  store = new Store(),
  rules: SeriesRules = { defaultGameRules: defaults(), games: {} },
) {
  act(store, {
    type: 'settings',
    settings: {
      ...store.data.state,
      blueTeam: { ...store.data.state.blueTeam, players: ['A1', 'A2', 'A3', 'A4', 'A5'] },
      redTeam: { ...store.data.state.redTeam, players: ['B1', 'B2', 'B3', 'B4', 'B5'] },
    },
  });
  act(store, { type: 'series_rules', seriesFormat: 'BO7', rules });
  return store;
}
function fill(store: Store) {
  while (!store.data.state.draftComplete) {
    const state = store.data.state;
    const phase = phases(state.draftMode, state.firstPickSide, state.banCount)[state.currentPhase];
    assert.ok(phase, 'normal zero-ban games must retain ten pick phases');
    if (phase.action === 'ban') act(store, { type: 'skip_ban', team: phase.team });
    else {
      const hero = heroesForPool(state.heroPool).find(
        (hero) =>
          !draftHeroUsed(state, hero.id) && !draftRestriction(state, phase.team, 'pick', hero.id),
      );
      assert.ok(hero, 'the configured pool has a legal next pick');
      act(store, { type: 'draft_action', ...phase, heroId: hero.id });
    }
  }
}
function start(store: Store) {
  if (store.data.state.draftMode === 'blind') act(store, { type: 'start_blind_game' });
  else {
    fill(store);
    act(store, { type: 'commit_game' });
  }
  const state = store.data.state;
  assert.ok(state.committedGameId);
  const report = state.postGameReports.find((report) => report.id === state.committedGameId)!;
  assert.equal(report.players.length, 10);
  assert.equal(report.gameNumber, state.draftGameNumber);
  return report;
}
function finish(store: Store, winner: Side, next = true) {
  act(store, { type: 'confirm_game_end', reportId: store.data.state.committedGameId!, winner });
  act(store, { type: 'score', team: winner, delta: 1 });
  if (next) act(store, { type: 'next_game' });
}

test('BO7 sweep ends at four wins and rejects a fifth win or another game', () => {
  const store = setup();
  for (let game = 1; game <= 4; game++) {
    assert.equal(store.data.state.gameNumber, game);
    start(store);
    finish(store, 'blue', game < 4);
  }
  assert.equal(store.data.state.blueScore, 4);
  assert.equal(seriesFinished(store.data.state), true);
  assert.equal(store.data.state.draftHistory.length, 4);
  const before = structuredClone(store.data);
  assert.throws(() => act(store, { type: 'next_game' }));
  assert.throws(() => act(store, { type: 'score', team: 'blue', delta: 1 }));
  assert.deepEqual(store.data, before);
});

test('seven mixed games retain independent rules, reports, history eligibility, restart and recovery', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hok-rules-seven-'));
  const file = join(directory, 'match.json'),
    uploads = join(directory, 'uploads');
  mkdirSync(uploads);
  const plan: SeriesRules = {
    defaultGameRules: defaults(),
    games: {
      '3': { mode: 'blind', banCount: 0, recordHeroes: false, contributeToFutureHistory: false },
      '4': { heroPool: 'cn', banCount: 5 },
      '5': {
        mode: 'normal',
        banCount: 0,
        enforcePreviousHistory: false,
        contributeToFutureHistory: false,
      },
      '6': { mode: 'blind', banCount: 0, recordHeroes: false, contributeToFutureHistory: false },
    },
  };
  try {
    let store = setup(new Store(file), plan);
    const gameIds: string[] = [];
    for (let game = 1; game <= 7; game++) {
      const before = store.data.state;
      assert.equal(before.gameNumber, game);
      if (game === 4 || game === 7) {
        for (const record of before.draftHistory.filter((record) => record.gameNumber <= 2)) {
          for (const hero of record.bluePicks)
            assert.equal(pickRestriction(before, 'blue', 0, hero), 'usedByTeam');
        }
      }
      if (game === 5) {
        assert.equal(before.draftMode, 'normal');
        assert.equal(before.banCount, 0);
        assert.equal(before.draftComplete, false);
        assert.equal(phases(before.draftMode, before.firstPickSide, before.banCount).length, 10);
      }
      const report = start(store);
      gameIds.push(report.id);
      act(store, {
        type: 'post_game_fields',
        reportId: report.id,
        updates: [
          {
            rowId: report.players[0].rowId,
            metric: 'kills',
            field: { value: game, confidence: 1, manual: true, sourcePage: 'record' },
          },
        ],
      });
      if (game === 3 || game === 6) {
        const record = store.data.state.draftHistory.at(-1)!;
        assert.deepEqual(record.bluePicks, []);
        assert.deepEqual(record.redPicks, []);
        assert.ok(report.players.every((player) => player.heroId == null));
      }
      if (game === 4) assert.equal(store.data.state.currentGameRules?.heroPool, 'cn');
      finish(store, game % 2 ? 'blue' : 'red', game < 7);
      if (game === 4) store = new Store(file);
    }
    assert.deepEqual([store.data.state.blueScore, store.data.state.redScore], [4, 3]);
    assert.equal(new Set(gameIds).size, 7);
    assert.equal(store.data.state.postGameReports.length, 7);
    for (const [index, report] of store.data.state.postGameReports.entries()) {
      assert.equal(report.id, gameIds[index]);
      assert.equal(report.players[0].fields.kills?.value, index + 1);
      assert.ok(report.endedAt);
    }
    assert.throws(() => act(store, { type: 'next_game' }));
    const archive = archiveData(file, uploads, false);
    const expected = structuredClone(store.data);
    act(store, { type: 'reset_match' });
    restoreArchive(archive, file, uploads);
    assert.deepEqual(new Store(file).data, expected);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('future changes, inherited defaults and format expansion never rewrite committed rule snapshots', () => {
  const store = setup();
  start(store);
  finish(store, 'blue');
  const prior = structuredClone(store.data.state.draftHistory[0]);
  const rules = structuredClone(store.data.state.seriesRules!);
  rules.games['4'] = { banCount: 5, heroPool: 'cn' };
  act(store, {
    type: 'series_rules',
    rules,
    seriesFormat: 'BO7',
    expectedRules: store.data.state.seriesRules,
  });
  assert.deepEqual(store.data.state.draftHistory[0], prior);
  const savedPlan = structuredClone(store.data.state.seriesRules);
  const forbidden = structuredClone(rules);
  forbidden.games['1'] = { mode: 'blind', banCount: 0 };
  assert.throws(() => act(store, { type: 'series_rules', rules: forbidden, seriesFormat: 'BO7' }));
  const phase = phases(
    store.data.state.draftMode,
    store.data.state.firstPickSide,
    store.data.state.banCount,
  )[0];
  act(store, { type: 'skip_ban', team: phase.team });
  const current = structuredClone(rules);
  current.games['2'] = { banCount: 0 };
  assert.throws(() => act(store, { type: 'series_rules', rules: current, seriesFormat: 'BO7' }));
  const future = structuredClone(rules);
  future.games['7'] = { firstPickSide: 'red' };
  act(store, { type: 'series_rules', rules: future, seriesFormat: 'BO7' });
  act(store, { type: 'undo' });
  assert.deepEqual(store.data.state.seriesRules, savedPlan);
});

test('independent enforce/contribute flags allow a fresh game to contribute later without deleting history', () => {
  const store = setup(new Store(), {
    defaultGameRules: defaults(),
    games: {
      '2': { enforcePreviousHistory: false },
      '3': { contributeToFutureHistory: false },
    },
  });
  start(store);
  const first = store.data.state.bluePicks[0];
  finish(store, 'blue');
  assert.equal(pickRestriction(store.data.state, 'blue', 0, first), undefined);
  start(store);
  const second = [...store.data.state.bluePicks];
  finish(store, 'red');
  for (const hero of second)
    assert.equal(pickRestriction(store.data.state, 'blue', 0, hero), 'usedByTeam');
  start(store);
  const third = [...store.data.state.bluePicks];
  finish(store, 'blue');
  for (const hero of third)
    assert.equal(pickRestriction(store.data.state, 'blue', 0, hero), undefined);
  assert.equal(store.data.state.draftHistory.length, 3);
});

test('optional blind heroes contribute actual ownership, not invented pick phases', () => {
  const store = setup(new Store(), {
    defaultGameRules: defaults(),
    games: {
      '1': { mode: 'blind', banCount: 0, recordHeroes: true, contributeToFutureHistory: true },
    },
  });
  start(store);
  const ids = heroesForPool('global')
    .slice(0, 10)
    .map((hero) => hero.id);
  act(store, { type: 'blind_lineup', blue: ids.slice(0, 5), red: ids.slice(5) });
  assert.deepEqual(store.data.state.draftHistory[0].bluePicks, []);
  finish(store, 'blue');
  assert.equal(pickRestriction(store.data.state, 'blue', 0, ids[0]), 'usedByTeam');
  assert.equal(banRestriction(store.data.state, 'red', ids[0]), 'opponentAlreadyUsed');
});

test('player restrictions preserve identity, substitutions, side swaps and shared Flowborn across pools', () => {
  const forms = heroesForPool('global').filter((hero) => hero.variantGroup === 'flowborn');
  assert.ok(forms.length > 1);
  const store = setup(new Store(), {
    defaultGameRules: defaults({ draftRuleMode: 'player', flowbornFormsIndependent: false }),
    games: {
      '1': { mode: 'blind', banCount: 0 },
      '2': { heroPool: 'cn' },
    },
  });
  start(store);
  act(store, {
    type: 'blind_lineup',
    blue: [forms[0].id, null, null, null, null],
    red: [null, null, null, null, null],
  });
  finish(store, 'blue');
  assert.equal(pickRestriction(store.data.state, 'blue', 0, forms[1].id), 'usedByPlayer');
  assert.equal(pickRestriction(store.data.state, 'blue', 1, forms[1].id), undefined);
  act(store, {
    type: 'settings',
    settings: {
      ...store.data.state,
      blueTeam: { ...store.data.state.blueTeam, players: ['Sub', 'A1', 'A3', 'A4', 'A5'] },
    },
  });
  assert.equal(pickRestriction(store.data.state, 'blue', 0, forms[1].id), undefined);
  assert.equal(pickRestriction(store.data.state, 'blue', 1, forms[1].id), 'usedByPlayer');
  act(store, { type: 'swap_sides' });
  assert.equal(pickRestriction(store.data.state, 'red', 1, forms[1].id), 'usedByPlayer');
  const shared = heroesForPool('global').find((hero) => heroAllowed('cn', hero.id));
  assert.ok(shared);
});

test('BO5 can extend while in progress, and shrinking never silently discards game six', () => {
  const store = setup();
  const plan = structuredClone(store.data.state.seriesRules!);
  act(store, { type: 'series_rules', rules: plan, seriesFormat: 'BO5' });
  start(store);
  finish(store, 'blue');
  act(store, { type: 'series_rules', rules: plan, seriesFormat: 'BO7' });
  assert.equal(store.data.state.seriesFormat, 'BO7');
  for (let game = 2; game <= 6; game++) {
    start(store);
    finish(store, game % 2 ? 'blue' : 'red', game < 6);
  }
  const before = structuredClone(store.data);
  assert.throws(() => act(store, { type: 'series_rules', rules: plan, seriesFormat: 'BO5' }));
  assert.deepEqual(store.data, before);
});

test('legacy BO5 records without rule fields continue contributing and migrate deterministically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hok-rules-legacy-'));
  const file = join(directory, 'match.json');
  try {
    const store = setup(new Store(file));
    start(store);
    finish(store, 'blue');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Store['data'];
    for (const state of [
      saved.state,
      ...saved.history,
      ...saved.events.map((event) => event.resultingState),
    ]) {
      delete state.seriesRules;
      delete state.currentGameRules;
      for (const record of state.draftHistory) delete record.rules;
    }
    saved.state.seriesFormat = 'BO5';
    writeFileSync(file, JSON.stringify(saved));
    const restored = new Store(file);
    assert.equal(
      pickRestriction(
        restored.data.state,
        'blue',
        0,
        restored.data.state.draftHistory[0].bluePicks[0],
      ),
      'usedByTeam',
    );
    assert.deepEqual(new Store(file).data, restored.data);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('history eligibility correction is audited, undoable and rejects downstream conflicts', () => {
  const store = setup(new Store(), {
    defaultGameRules: defaults({ banCount: 0 }),
    games: {
      '1': { contributeToFutureHistory: false },
    },
  });
  start(store);
  const record = store.data.state.draftHistory[0];
  finish(store, 'blue');
  const before = structuredClone(store.data.state);
  assert.throws(() =>
    act(store, {
      type: 'correct_history_rules',
      gameId: record.id,
      contributeToFutureHistory: true,
      reason: '',
    }),
  );
  act(store, {
    type: 'correct_history_rules',
    gameId: record.id,
    contributeToFutureHistory: true,
    reason: 'Organizer corrected game one eligibility',
  });
  assert.equal(store.data.state.rulesCorrections?.at(-1)?.gameId, record.id);
  assert.equal(pickRestriction(store.data.state, 'blue', 0, record.bluePicks[0]), 'usedByTeam');
  act(store, { type: 'undo' });
  assert.deepEqual(store.data.state, before);
  start(store);
  assert.ok(store.data.state.bluePicks.includes(record.bluePicks[0]));
  const unchanged = structuredClone(store.data);
  assert.throws(() =>
    act(store, {
      type: 'correct_history_rules',
      gameId: record.id,
      contributeToFutureHistory: true,
      reason: 'Would make game two illegal',
    }),
  );
  assert.deepEqual(store.data, unchanged);
});

test('late blind hero entries cannot invalidate a later confirmed game', () => {
  const store = setup(new Store(), {
    defaultGameRules: defaults({ banCount: 0 }),
    games: {
      '1': { mode: 'blind', recordHeroes: true },
    },
  });
  start(store);
  const blindId = store.data.state.committedGameId!;
  finish(store, 'blue');
  start(store);
  const repeated = store.data.state.bluePicks[0],
    before = structuredClone(store.data);
  assert.throws(() =>
    act(store, {
      type: 'blind_lineup',
      gameId: blindId,
      blue: [repeated, null, null, null, null],
      red: [null, null, null, null, null],
    }),
  );
  assert.deepEqual(store.data, before);
});
