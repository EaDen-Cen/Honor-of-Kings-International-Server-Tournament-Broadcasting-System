import type { GameDraftRecord, MatchState, PlayerRole, Side } from './types.js';

export const gameRoles: PlayerRole[] = ['clash', 'jungle', 'mid', 'farm', 'roam'];
export type GameLineup = Pick<
  MatchState,
  'blueTeam' | 'redTeam' | 'blueGameRoles' | 'redGameRoles'
>;
export function validGameRoles(value: unknown): value is PlayerRole[] {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    new Set(value).size === 5 &&
    value.every((role) => gameRoles.includes(role))
  );
}
/** Roles are indexed by roster identity, independently of screen slots and hero ownership. */
export function rolesForGame(game: GameLineup | GameDraftRecord, side: Side): PlayerRole[] {
  const roles = game[`${side}GameRoles`];
  if (validGameRoles(roles)) return roles;
  const defaults = game[`${side}Team`].playerRoles;
  return validGameRoles(defaults) ? defaults : gameRoles;
}
