import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, phases } from '../src/shared/types.js';
import { swappedFinalPickIndex } from '../src/control/finalPickRecovery.js';

test('only a complete legal five in the last phase identifies a missing pick', () => {
  for (const last of ['blue', 'red'] as const) {
    const first = last === 'blue' ? 'red' : 'blue';
    const state = initialState();
    state.firstPickSide = first;
    state.currentPhase = phases(state.draftMode, first, state.banCount).length - 1;
    state[`${first}Picks`] = [10, 11, 12, 13, 14];
    state[`${last}Picks`] = [1, 2, 3, 4];
    state[`${last}Bans`] = [9];
    assert.equal(swappedFinalPickIndex(state, last, [1, 5, 3, 4, 2]), 1);
    for (const observed of [
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 2],
      [1, 5, 3, undefined, 2],
      [1, 5, 3, 6, 2],
      [1, 9, 3, 4, 2],
      [1, 10, 3, 4, 2],
      [1, 99999, 3, 4, 2],
    ])
      assert.equal(swappedFinalPickIndex(state, last, observed), undefined);
    state.currentPhase--;
    assert.equal(swappedFinalPickIndex(state, last, [1, 5, 3, 4, 2]), undefined);
  }
});
