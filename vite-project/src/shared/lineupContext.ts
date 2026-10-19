import type { MatchState } from './types.js';

/** The game and player-slot identity which a final-lineup capture belongs to. */
export function lineupIdentityContext(state: MatchState): string {
  return JSON.stringify([
    'lineup-identity-v1',
    state.gameNumber, state.draftGameNumber, state.currentPhase,
    state.draftComplete, state.committedGameId,
    state.displayLeftSide, state.firstPickSide, state.sideSwapMode,
    state.blueTeam.id, state.blueTeam.players, state.blueTeam.playerRoles,
    state.redTeam.id, state.redTeam.players, state.redTeam.playerRoles,
    state.bluePicks, state.redPicks,
    state.bluePlayerSlotOrder, state.redPlayerSlotOrder,
  ]);
}

/** Compare before writing; an intervening manual swap must invalidate old OCR. */
export function lineupWriteContext(state: MatchState): string {
  return JSON.stringify([
    'lineup-write-v1', lineupIdentityContext(state),
    state.blueAssignments, state.redAssignments,
  ]);
}
