import type { MatchState } from './types.js';
import { normalizePlayerText, validPlayerSlotOrder } from './playerSlots.js';

/**
 * A human preflight acknowledgement is valid only for this game's actual
 * roster and authoritative P1–P5 permutations. BP actions must not invalidate
 * it; changing an ID or either team's slot order must invalidate it.
 */
export function playerOrderCheckKey(state:MatchState):string {
  return JSON.stringify([
    state.stage,
    state.gameNumber,
    state.blueTeam.id,
    state.redTeam.id,
    state.blueTeam.players,
    state.redTeam.players,
    state.bluePlayerSlotOrder,
    state.redPlayerSlotOrder,
  ]);
}

/** Prevent a green "checked" badge when there is no complete roster to check. */
export function canVerifyPlayerOrder(state:MatchState):boolean {
  return (['blue','red'] as const).every(side=>{
    const players=state[`${side}Team`].players.map(normalizePlayerText);
    return players.length===5&&players.every(Boolean)&&new Set(players).size===5&&
      validPlayerSlotOrder(state[`${side}PlayerSlotOrder`]);
  });
}
