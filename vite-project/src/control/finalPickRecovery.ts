import { draftHeroUsed, draftRestriction } from '../shared/draftRules.js';
import { heroAllowed } from '../shared/heroPool.js';
import { phases, type MatchState, type Side } from '../shared/types.js';

/** Only the tenth pick is determined by the visible five minus the four recorded picks. */
export function swappedFinalPickIndex(
  state: MatchState,
  side: Side,
  observed: readonly (number | undefined)[],
) {
  const sequence = phases(state.draftMode, state.firstPickSide, state.banCount);
  const known = state[`${side}Picks`];
  if (
    state.committedGameId ||
    state.currentPhase !== sequence.length - 1 ||
    sequence[state.currentPhase]?.team !== side ||
    known.length !== 4 ||
    observed.length !== 5 ||
    new Set(observed).size !== 5 ||
    !known.every((id) => observed.includes(id)) ||
    !known.includes(observed[4] ?? -1)
  )
    return;

  const index = observed.findIndex((id) => id !== undefined && !known.includes(id));
  const heroId = observed[index];
  if (
    heroId !== undefined &&
    heroAllowed(state.heroPool, heroId) &&
    !draftHeroUsed(state, heroId) &&
    !draftRestriction(state, side, 'pick', heroId)
  )
    return index;
}
