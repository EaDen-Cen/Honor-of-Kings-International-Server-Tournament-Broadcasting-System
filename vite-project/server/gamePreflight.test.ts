import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { initialState, phases, type Action, type MatchState } from '../src/shared/types.js';
import { gamePreflightIssues, isPlayerSlotVerified, playerSlotWriteContext, validateGameReady } from '../src/shared/gamePreflight.js';
import heroes from '../src/components/HeroList.js';

const apply = (store: Store, action: Action) => store.apply(randomUUID(), store.data.revision, action);
function configured(file?: string) {
  const store = new Store(file), state = initialState();
  state.blueTeam.players = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  state.redTeam.players = ['Fox', 'Golf', 'Hotel', 'India', 'Juliet'];
  state.banCount = 0;
  apply(store, {type: 'settings', settings: state});
  return store;
}
function verification(state: MatchState): Extract<Action, {type: 'verify_player_slot_orders'}> {
  return {type: 'verify_player_slot_orders', blue: [...state.bluePlayerSlotOrder], red: [...state.redPlayerSlotOrder],
    expectedPlayers: [[...state.blueTeam.players], [...state.redTeam.players]], expectedContext: playerSlotWriteContext(state)};
}
function fill(store: Store) {
  const state = store.data.state;
  phases(state.draftMode, state.firstPickSide, state.banCount).forEach((phase, i) => apply(store, {type: 'draft_action', ...phase, heroId: heroes[i].id}));
}

test('server verification accepts an unchanged reviewed order, persists and survives ordinary BP and commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'hok-preflight-')), file = join(root, 'match.json');
  try {
    const store = configured(file);
    assert.equal(isPlayerSlotVerified(store.data.state, 'blue'), false);
    assert.equal(validateGameReady(store.data.state).ready, false);
    apply(store, verification(store.data.state));
    for (const side of ['blue', 'red'] as const) assert.equal(isPlayerSlotVerified(store.data.state, side), true);
    assert.deepEqual(new Store(file).data.state.playerSlotVerification, store.data.state.playerSlotVerification);
    fill(store);
    assert.equal(validateGameReady(store.data.state).ready, true);
    const picks = [...store.data.state.bluePicks];
    apply(store, {type: 'commit_game'});
    assert.equal(validateGameReady(store.data.state).ready, true);
    apply(store, verification(store.data.state)); // An already committed, unchanged game can still be checked.
    assert.equal(validateGameReady(store.data.state).ready, true);
    assert.deepEqual(store.data.state.bluePicks, picks);
    apply(store, {type: 'score', team: 'blue', delta: 1});
    assert.equal(isPlayerSlotVerified(store.data.state, 'blue'), true);
    assert.ok(gamePreflightIssues(store.data.state).some(issue => issue.code === 'current_game'));
    apply(store, {type: 'next_game'});
    assert.equal(store.data.state.playerSlotVerification, undefined);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('manual and OCR order writes verify only legal saved identities and never mutate pick history', () => {
  const store = configured();
  fill(store);
  const picks = structuredClone([store.data.state.bluePicks, store.data.state.redPicks]);
  apply(store, {type: 'set_player_slot_order', side: 'blue', order: [4, 3, 2, 1, 0], expectedPlayers: store.data.state.blueTeam.players,
    expectedContext: playerSlotWriteContext(store.data.state)});
  assert.equal(isPlayerSlotVerified(store.data.state, 'blue'), true);
  assert.equal(isPlayerSlotVerified(store.data.state, 'red'), false);
  apply(store, {type: 'set_player_slot_order', side: 'red', order: [1, 0, 2, 3, 4], expectedPlayers: store.data.state.redTeam.players});
  assert.equal(validateGameReady(store.data.state).ready, true);
  assert.deepEqual([store.data.state.bluePicks, store.data.state.redPicks], picks);
  apply(store, {type: 'set_player_slot_orders', blue: [0, 1, 2, 3, 4], red: [0, 1, 2, 3, 4],
    expectedPlayers: [store.data.state.blueTeam.players, store.data.state.redTeam.players]});
  assert.equal(validateGameReady(store.data.state).ready, true);
});

test('rosters, roles, screen sides, games and resets expire verification; reversing changes cannot revive it', () => {
  const store = configured();
  const verify = () => apply(store, verification(store.data.state));
  verify();
  const changed = structuredClone(store.data.state); changed.blueTeam.players[0] = 'Substitute';
  apply(store, {type: 'settings', settings: changed});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  changed.blueTeam.players[0] = 'Alpha';
  apply(store, {type: 'settings', settings: changed});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  verify();
  const roles = structuredClone(store.data.state); [roles.blueTeam.playerRoles[0], roles.blueTeam.playerRoles[1]] = [roles.blueTeam.playerRoles[1], roles.blueTeam.playerRoles[0]];
  apply(store, {type: 'settings', settings: roles});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  verify(); apply(store, {type: 'swap_sides'}); apply(store, {type: 'swap_sides'});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  verify(); apply(store, {type: 'reset_draft'});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  verify(); apply(store, {type: 'score', team: 'blue', delta: 1});
  assert.equal(store.data.state.playerSlotVerification, undefined);
});

test('late unchanged verification is rejected atomically when order, roles or side changed even at fresh revision', () => {
  for (const change of ['order', 'roles', 'side'] as const) {
    const store = configured(), stale = verification(store.data.state);
    if (change === 'order') apply(store, {type: 'set_player_slot_order', side: 'blue', order: [1, 0, 2, 3, 4], expectedPlayers: store.data.state.blueTeam.players});
    else if (change === 'roles') {
      const state = structuredClone(store.data.state); [state.redTeam.playerRoles[0], state.redTeam.playerRoles[1]] = [state.redTeam.playerRoles[1], state.redTeam.playerRoles[0]];
      apply(store, {type: 'settings', settings: state});
    } else apply(store, {type: 'swap_sides'});
    const before = structuredClone(store.data);
    assert.throws(() => apply(store, stale), /Player identity context changed/);
    assert.deepEqual(store.data, before);
    assert.throws(() => apply(store, {...verification(store.data.state), blue: [4, 3, 2, 1, 0]}), /Player order changed/);
    assert.deepEqual(store.data, before);
  }
});

test('incomplete or duplicate identities and roles never pass Game readiness while ordinary BP remains usable', () => {
  const store = new Store();
  apply(store, {type: 'set_player_slot_order', side: 'blue', order: [1, 0, 2, 3, 4], expectedPlayers: store.data.state.blueTeam.players});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  fill(store); // Missing IDs cannot block the established normal-BP workflow.
  assert.equal(validateGameReady(store.data.state).ready, false);
  assert.throws(() => apply(store, verification(store.data.state)), /ID/);
  const configuredStore = configured(), state = structuredClone(configuredStore.data.state);
  state.redTeam.players[0] = ' ＡＬＰＨＡ ';
  state.redTeam.playerRoles[0] = 'jungle';
  apply(configuredStore, {type: 'settings', settings: state});
  assert.deepEqual(gamePreflightIssues(configuredStore.data.state).map(issue => issue.code), ['player_ids', 'player_roles', 'player_order', 'draft', 'lineup']);
  assert.throws(() => apply(configuredStore, verification(configuredStore.data.state)));
});

test('settings cannot inject proof; malformed archived proof and undo do not masquerade as a fresh check', () => {
  const store = configured(), proposed = structuredClone(store.data.state);
  proposed.playerSlotVerification = {blue: 'pretend-verified', red: 'pretend-verified'};
  apply(store, {type: 'settings', settings: proposed});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  apply(store, verification(store.data.state));
  apply(store, {type: 'delay', seconds: 0});
  apply(store, {type: 'undo'});
  assert.equal(store.data.state.playerSlotVerification, undefined);
  const root = mkdtempSync(join(tmpdir(), 'hok-bad-preflight-')), file = join(root, 'match.json');
  try {
    const corrupt = structuredClone(store.data); corrupt.state.playerSlotVerification = {blue: 'wrong'};
    writeFileSync(file, JSON.stringify(corrupt));
    assert.equal(new Store(file).data.state.playerSlotVerification, undefined);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('complete but invalid ownership or a roster changed after commit prevents entering Game', () => {
  const store = configured(); fill(store); apply(store, verification(store.data.state));
  assert.equal(validateGameReady(store.data.state).ready, true);
  const invalid = structuredClone(store.data.state); invalid.blueAssignments[0] = invalid.redAssignments[0];
  assert.ok(gamePreflightIssues(invalid).some(issue => issue.code === 'lineup'));
  apply(store, {type: 'commit_game'});
  const changed = structuredClone(store.data.state); changed.blueTeam.players[0] = 'Substitute';
  apply(store, {type: 'settings', settings: changed}); apply(store, verification(store.data.state));
  assert.ok(gamePreflightIssues(store.data.state).some(issue => issue.code === 'current_game'));
});
