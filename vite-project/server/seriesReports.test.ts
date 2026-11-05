import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import heroes from '../src/components/HeroList.js';
import { phases, type Action } from '../src/shared/types.js';

for (const count of [1, 3, 5] as const) {
  test(`BO${count} reports survive restart, retries, undo and history edits without cross-game fields`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'hok-series-'));
    const file = join(directory, 'match.json');
    let store = new Store(file);
    const apply = (action: Action) => store.apply(randomUUID(), store.data.revision, action);
    try {
      apply({ type: 'settings', settings: { ...store.data.state, seriesFormat: `BO${count}` } });
      const ids: string[] = [];
      for (let game = 1; game <= count; game++) {
        phases('match').forEach((phase, index) => apply({ type: 'draft_action', ...phase, heroId: heroes[index].id }));
        const actionId = randomUUID(), revision = store.data.revision;
        store.apply(actionId, revision, { type: 'commit_game' });
        store.apply(actionId, revision, { type: 'commit_game' });
        const report = store.data.state.postGameReports.at(-1)!;
        ids.push(report.id);
        assert.equal(store.data.state.activePostGameReportId, report.id);
        assert.deepEqual(report.players[0].fields, {});
        apply({ type: 'post_game_fields', reportId: report.id, updates: [{ rowId: report.players[0].rowId, metric: 'kills', field: { value: game, manual: true, confidence: 1, sourcePage: 'summary' } }] });
        apply({ type: 'score', team: game % 2 ? 'blue' : 'red', delta: 1 });
        if (game < count) {
          apply({ type: 'next_game' });
          assert.equal(store.data.state.activePostGameReportId, null, 'new game must not silently edit the previous report');
          apply({ type: 'undo' });
          assert.equal(store.data.state.activePostGameReportId, report.id);
          apply({ type: 'next_game' });
          apply({ type: 'swap_sides' });
          apply({ type: 'swap_sides' });
        }
        store = new Store(file);
        assert.deepEqual(store.data.state.postGameReports.map(r => r.players[0].fields.kills?.value), Array.from({ length: game }, (_, i) => i + 1));
      }
      assert.equal(new Set(ids).size, count);
      apply({ type: 'post_game_begin', gameId: ids[0] });
      assert.equal(store.data.state.activePostGameReportId, ids[0]);
      assert.equal(store.data.state.postGameReports.length, count);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
