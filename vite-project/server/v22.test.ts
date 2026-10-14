import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './store.js';
import heroes from '../src/components/HeroList.js';
import { phases, type Action, type MatchState } from '../src/shared/types.js';
import { displaySides, pickRestriction, banRestriction } from '../src/shared/draftRules.js';
const act = (s: Store, action: Action) => s.apply(randomUUID(), s.data.revision, action);
function fill(s: Store) {
  while (!s.data.state.draftComplete) {
    const state = s.data.state, phase = phases(state.draftMode, state.firstPickSide)[state.currentPhase];
    const used = [...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks];
    const hero = heroes.find(h => !used.includes(h.id) && (phase.action === 'ban' ? !banRestriction(state, phase.team, h.id) : !pickRestriction(state, phase.team, state[`${phase.team}Picks`].length, h.id)))!;
    act(s, { type: 'draft_action', ...phase, heroId: hero.id });
  }
}
test('both formats mirror every phase for red first, complete, and record the starter', () => {
  for (const draftMode of ['normal', 'match'] as const) {
    const blue = phases(draftMode, 'blue'), red = phases(draftMode, 'red');
    blue.forEach((phase, i) => { assert.notEqual(phase.team, red[i].team); assert.equal(phase.action, red[i].action); });
    const s = new Store(); act(s, { type: 'settings', settings: { ...s.data.state, draftMode,banCount:draftMode==='normal'?2:4, firstPickSide: 'red' } });
    assert.throws(() => act(s, { type: 'draft_action', team: 'blue', action: 'ban', heroId: 1 }));
    fill(s);
    assert.equal(s.data.state.bluePicks.length, 5); assert.equal(s.data.state.redPicks.length, 5);
    assert.equal(s.data.state.blueBans.length, draftMode === 'match' ? 4 : 2);
    act(s, { type: 'commit_game' }); assert.equal(s.data.state.draftHistory[0].firstPickSide, 'red');
    act(s, { type: 'score', team: 'red', delta: 1 }); act(s, { type: 'next_game' });
    act(s, { type: 'settings', settings: { ...s.data.state, firstPickSide: 'blue' } }); fill(s);
    assert.equal(s.data.state.draftComplete, true);
  }
});
test('first pick metadata is live, locks after first ban, unlocks on reset and remains undoable', () => {
  let now = 1000000; const s = new Store(undefined, () => now);
  act(s, { type: 'settings', settings: { ...s.data.state, firstPickSide: 'red' } });
  assert.equal(s.snapshot('caster').state.firstPickSide, 'red');
  now += 180000; assert.equal(s.snapshot('caster').state.firstPickSide, 'red');
  act(s, { type: 'draft_action', team: 'red', action: 'ban', heroId: 1 });
  assert.throws(() => act(s, { type: 'settings', settings: { ...s.data.state, firstPickSide: 'blue' } }), /firstPickLocked/);
  act(s, { type: 'reset_draft' }); act(s, { type: 'settings', settings: { ...s.data.state, firstPickSide: 'blue' } });
  act(s, { type: 'undo' }); assert.equal(s.data.state.firstPickSide, 'red');
});
test('colors-only preserves screen positions and score ownership; moving teams exchanges positions', () => {
  const s = new Store(); const originalTeam = s.data.state.blueTeam.id;
  act(s, { type: 'score', team: 'blue', delta: 1 });
  act(s, { type: 'settings', settings: { ...s.data.state, sideSwapMode: 'colorsOnly', firstPickSide: 'red', blueTeam: { ...s.data.state.blueTeam, playerPortraits: ['/playerImg/a.png', '', '', '', ''] } } });
  act(s, { type: 'swap_sides' });
  assert.equal(s.data.state.displayLeftSide, 'red');
  assert.equal(s.data.state.redTeam.id, originalTeam); assert.equal(s.data.state.redScore, 1);
  assert.equal(s.data.state.redTeam.playerPortraits[0], '/playerImg/a.png');
  assert.equal(s.data.state.firstPickSide, 'red');
  assert.equal(s.data.state[`${displaySides(s.data.state)[0]}Team`].id, originalTeam);
  act(s, { type: 'settings', settings: { ...s.data.state, sideSwapMode: 'moveTeams' } });
  act(s, { type: 'swap_sides' });
  assert.equal(s.data.state.displayLeftSide, 'red');
  assert.equal(s.data.state[`${displaySides(s.data.state)[1]}Team`].id, originalTeam);
  act(s, { type: 'undo' }); assert.equal(s.data.state.redTeam.id, originalTeam);
});
test('global and personal histories survive colors-only swaps and are enforced for red first', () => {
  for (const draftRuleMode of ['global', 'player'] as const) {
    const s = new Store();
    act(s, { type: 'settings', settings: { ...s.data.state, draftRuleMode, sideSwapMode: 'colorsOnly',
      blueTeam: { ...s.data.state.blueTeam, players: ['a', 'b', 'c', 'd', 'e'] }, redTeam: { ...s.data.state.redTeam, players: ['f', 'g', 'h', 'i', 'j'] },
    } });
    fill(s); const forbidden = s.data.state.bluePicks[0];
    act(s, { type: 'commit_game' }); act(s, { type: 'score', team: 'blue', delta: 1 }); act(s, { type: 'next_game' });
    act(s, { type: 'swap_sides' }); act(s, { type: 'settings', settings: { ...s.data.state, firstPickSide: 'red' } });
    for (let i = 0; i < 4; i++) act(s, { type: 'draft_action', ...phases('match', 'red')[i], heroId: heroes[80 + i].id });
    if (draftRuleMode === 'global') {
      assert.throws(() => act(s, { type: 'draft_action', team: 'red', action: 'pick', heroId: forbidden }), /usedByTeam/);
    } else {
      // Player BP permits a teammate to help-pick the hero; final ownership is checked at commit.
      act(s, { type: 'draft_action', team: 'red', action: 'pick', heroId: forbidden });
      fill(s);
      assert.throws(() => act(s, { type: 'commit_game' }), /usedByPlayer/);
      act(s, { type: 'swap_assignments', team: 'red', from: 0, to: 1 });
      act(s, { type: 'commit_game' });
    }
    assert.equal(pickRestriction(s.data.state, 'blue', 0, forbidden), undefined);
    assert.equal(s.data.state.displayLeftSide, 'red');
  }
});
test('portrait validation accepts HTTPS/local files, rejects malformed arrays and unsafe addresses', () => {
  const s = new Store();
  const settings = () => ({ ...s.data.state, blueTeam: { ...s.data.state.blueTeam, playerPortraits: ['https://example.com/player.png', '/playerImg/a.png', '', '', ''] } });
  act(s, { type: 'settings', settings: settings() });
  for (const invalid of ['http://example.com/a.png', '//example.com/a.png', '/\\example.com/a.png', 'javascript:alert(1)', 'https://', 'data:image/png;base64,a', '/a\nb', 'x'.repeat(1001)]) {
    const next = settings(); next.blueTeam.playerPortraits[0] = invalid;
    assert.throws(() => act(s, { type: 'settings', settings: next }));
  }
  const short = settings(); short.blueTeam.playerPortraits.pop();
  assert.throws(() => act(s, { type: 'settings', settings: short }), /portraitsInvalid/);
  assert.equal(s.data.state.blueTeam.playerPortraits[1], '/playerImg/a.png');
});
test('V2 migration normalizes new fields in state, undo, delayed events and nested committed teams', () => {
  const s = new Store(); fill(s); act(s, { type: 'commit_game' });
  const legacy = JSON.parse(JSON.stringify(s.data));
  for (const state of [legacy.state, ...legacy.history, ...legacy.events.map((e: {resultingState: MatchState}) => e.resultingState)]) {
    delete state.firstPickSide; delete state.sideSwapMode; delete state.displayLeftSide;
    delete state.blueTeam.playerPortraits; delete state.redTeam.playerPortraits;
    for (const game of state.draftHistory) { delete game.firstPickSide; delete game.blueTeam.playerPortraits; delete game.redTeam.playerPortraits; }
  }
  const file = join(mkdtempSync(join(tmpdir(), 'hok-v22-')), 'match.json'); writeFileSync(file, JSON.stringify(legacy));
  const restored = new Store(file, () => Date.now() + 999999);
  for (const state of [restored.data.state, ...restored.data.history, restored.snapshot('caster').state]) {
    assert.equal(state.displayLeftSide, 'blue'); assert.equal(state.firstPickSide, 'blue'); assert.equal(state.sideSwapMode, 'moveTeams');
    assert.deepEqual(state.blueTeam.playerPortraits, ['', '', '', '', '']);
    for (const game of state.draftHistory) { assert.equal(game.firstPickSide, 'blue'); assert.equal(game.redTeam.playerPortraits.length, 5); }
  }
  act(restored, { type: 'undo' }); assert.equal(restored.data.state.draftComplete, true);
});


test('legacy hero IDs migrate atomically across state, history, events and overrides', () => {
  const seed = new Store();
  const legacy = JSON.parse(JSON.stringify(seed.data));
  legacy.version = 1;
  const decorate = (state: MatchState) => {
    state.blueBans = [1, 120];
    state.redBans = [54];
    state.bluePicks = [1, 54, 120];
    state.redPicks = [85];
    state.blueAssignments = [1, 54, 120, null, null];
    state.redAssignments = [85, null, null, null, null];
    state.heroArtOverrides = {
      '1': { panel: { x: 50, y: 50, scale: 1.2 } },
      '120': { side: { x: 60, y: 40, scale: 1.4 } },
    };
    state.heroDataOverrides = {
      '54': { chineseName: '敖隐测试' },
    };
  };
  decorate(legacy.state);
  legacy.history = [JSON.parse(JSON.stringify(legacy.state))];
  legacy.events = [{
    id: 'legacy-event',
    timestamp: 1,
    type: 'legacy',
    resultingState: JSON.parse(JSON.stringify(legacy.state)),
    revision: 1,
  }];

  const file = join(mkdtempSync(join(tmpdir(), 'hok-release-id-')), 'match.json');
  writeFileSync(file, JSON.stringify(legacy));
  const restored = new Store(file);

  assert.equal(restored.data.version, 2);
  for (const state of [
    restored.data.state,
    ...restored.data.history,
    ...restored.data.events.map(event => event.resultingState),
  ]) {
    assert.deepEqual(state.blueBans, [72, 119]);
    assert.deepEqual(state.redBans, [88]);
    assert.deepEqual(state.bluePicks, [72, 88, 119]);
    assert.deepEqual(state.redPicks, [1]);
    assert.deepEqual(state.blueAssignments, [72, 88, 119, null, null]);
    assert.deepEqual(state.redAssignments, [1, null, null, null, null]);
    assert.ok(state.heroArtOverrides['72']);
    assert.ok(state.heroArtOverrides['119']);
    assert.equal(state.heroArtOverrides['1'], undefined);
    assert.equal(state.heroDataOverrides['88']?.chineseName, '敖隐测试');
  }
});