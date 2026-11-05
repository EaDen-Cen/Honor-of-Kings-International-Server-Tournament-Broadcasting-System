import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import heroes from '../src/components/HeroList.js';
import { phases, type Action } from '../src/shared/types.js';
import { rolesForGame, gameRoles } from '../src/shared/gameLineup.js';
import { playerAtSlot } from '../src/shared/playerSlots.js';
import { normalizeState } from '../src/shared/draftRules.js';
import { initialState } from '../src/shared/types.js';

for (const count of [1, 3, 5] as const)
  test(`BO${count} actual roles and hero ownership remain independent across history, restart and Undo`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'hok-roles-')),
      file = join(directory, 'match.json');
    let store = new Store(file);
    const apply = (action: Action) => store.apply(randomUUID(), store.data.revision, action);
    try {
      apply({ type: 'settings', settings: { ...store.data.state, seriesFormat: `BO${count}` } });
      const defaults = structuredClone(store.data.state.blueTeam);
      let first = '';
      for (let game = 1; game <= count; game++) {
        assert.deepEqual(rolesForGame(store.data.state, 'blue'), defaults.playerRoles);
        phases('match').forEach((phase, index) =>
          apply({ type: 'draft_action', ...phase, heroId: heroes[index].id }),
        );
        const picks = [...store.data.state.bluePicks],
          assignments = [...store.data.state.blueAssignments];
        const roles = [...gameRoles];
        [roles[0], roles[3]] = [roles[3], roles[0]];
        apply({ type: 'set_game_roles', side: 'blue', roles });
        assert.equal(playerAtSlot(store.data.state, 'blue', 0).role, 'farm');
        assert.deepEqual(store.data.state.blueAssignments, assignments);
        assert.deepEqual(store.data.state.blueTeam, defaults);
        apply({ type: 'swap_assignments', team: 'blue', from: 0, to: 3 });
        assert.deepEqual(store.data.state.bluePicks, picks);
        assert.deepEqual(rolesForGame(store.data.state, 'blue'), roles);
        assert.equal(store.data.state.blueAssignments[0], assignments[3]);
        apply({ type: 'confirm_game_lineup', confirmed: true });
        assert.throws(() =>
          apply({
            type: 'set_lineup_assignments',
            blue: assignments as number[],
            red: store.data.state.redAssignments as number[],
          }),
        );
        assert.throws(() =>
          apply({
            type: 'set_player_slot_order',
            side: 'blue',
            order: [3, 1, 2, 0, 4],
            expectedPlayers: defaults.players,
            source: 'automatic',
          }),
        );
        apply({ type: 'commit_game' });
        const report = store.data.state.postGameReports.at(-1)!;
        first ||= report.id;
        const row = report.players[0];
        apply({
          type: 'post_game_fields',
          reportId: report.id,
          updates: [
            {
              rowId: row.rowId,
              metric: 'kills',
              field: { value: game, manual: true, confidence: 1, sourcePage: 'summary' },
            },
          ],
        });
        apply({ type: 'select_mvp', reportId: report.id, rowId: row.rowId });
        apply({ type: 'confirm_game_lineup', confirmed: false });
        apply({ type: 'set_game_roles', side: 'blue', roles: [...gameRoles] });
        assert.equal(store.data.state.postGameReports.at(-1)!.players[0].role, 'clash');
        assert.equal(store.data.state.postGameReports.at(-1)!.players[0].fields.kills?.value, game);
        assert.equal(store.data.state.postGameReports.at(-1)!.selectedMvpRowId, row.rowId);
        apply({ type: 'undo' });
        assert.equal(store.data.state.postGameReports.at(-1)!.players[0].role, 'farm');
        store = new Store(file);
        assert.equal(store.data.state.postGameReports.at(-1)!.players[0].role, 'farm');
        apply({ type: 'score', team: game % 2 ? 'blue' : 'red', delta: 1 });
        if (game < count) apply({ type: 'next_game' });
      }
      const current = structuredClone(store.data.state.blueAssignments);
      const originalHero = store.data.state.postGameReports[0].players[3].heroId;
      apply({ type: 'swap_assignments', team: 'blue', from: 0, to: 3, gameId: first });
      assert.equal(store.data.state.postGameReports[0].players[0].heroId, originalHero);
      assert.equal(store.data.state.postGameReports[0].players[0].fields.kills?.value, 1);
      if (count > 1) assert.deepEqual(store.data.state.blueAssignments, current);
      apply({ type: 'set_game_roles', side: 'blue', roles: [...gameRoles], gameId: first });
      assert.equal(store.data.state.postGameReports[0].players[0].role, 'clash');
      if (count > 1) {
        assert.deepEqual(store.data.state.blueAssignments, current);
        assert.equal(rolesForGame(store.data.state, 'blue')[0], 'farm');
      }
      assert.deepEqual(
        store.data.state.postGameReports.map((report) => report.players[0].fields.kills?.value),
        Array.from({ length: count }, (_, i) => i + 1),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('legacy snapshots derive roles from preset identities, independently of screen slots', () => {
  const legacy = initialState();
  legacy.bluePlayerSlotOrder = [3, 1, 2, 0, 4];
  const migrated = normalizeState(legacy);
  assert.deepEqual(rolesForGame(migrated, 'blue'), legacy.blueTeam.playerRoles);
  assert.equal(playerAtSlot(migrated, 'blue', 0).role, 'farm');
  assert.equal(migrated.lineupConfirmed, false);
});
