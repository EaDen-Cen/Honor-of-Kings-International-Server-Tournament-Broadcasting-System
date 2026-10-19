import type { MatchState, Side } from './types.js';
import { draftHeroGroupKey, pickRestriction, playerIdentity } from './draftRules.js';
import { heroAllowed } from './heroPool.js';
import { validPlayerSlotOrder } from './playerSlots.js';

const sides = ['blue', 'red'] as const;
const roles = ['clash', 'jungle', 'mid', 'farm', 'roam'];

/** Stable during this game's BP; a changed roster, role or screen side needs a new check. */
export function playerSlotVerificationContext(state: MatchState, side: Side): string {
  return JSON.stringify([
    'player-slot-verification-v1', state.stage, state.draftGameNumber ?? state.gameNumber,
    state.displayLeftSide, state.firstPickSide, state.sideSwapMode,
    state.blueTeam.id, state.blueTeam.players, state.blueTeam.playerRoles,
    state.redTeam.id, state.redTeam.players, state.redTeam.playerRoles,
    side, state[`${side}PlayerSlotOrder`],
  ]);
}

/** Guard even an unchanged manual confirmation against an intervening correction. */
export function playerSlotWriteContext(state: MatchState): string {
  return JSON.stringify(sides.map(side => playerSlotVerificationContext(state, side)));
}

export function isPlayerSlotVerified(state: MatchState, side: Side): boolean {
  return validPlayerSlotOrder(state[`${side}PlayerSlotOrder`])
    && playerIdentityIssues(state).length === 0
    && typeof state.playerSlotVerification?.[side] === 'string'
    && state.playerSlotVerification[side] === playerSlotVerificationContext(state, side);
}

/** Drop expired proof rather than letting a later reversal revive an old check. */
export function prunePlayerSlotVerification(state: MatchState): void {
  const verified = Object.fromEntries(sides.filter(side => isPlayerSlotVerified(state, side))
    .map(side => [side, state.playerSlotVerification![side]]));
  if (Object.keys(verified).length) state.playerSlotVerification = verified;
  else delete state.playerSlotVerification;
}

export interface GamePreflightIssue {
  code: 'player_ids' | 'player_roles' | 'player_order' | 'draft' | 'lineup' | 'current_game';
  message: string;
}

/** These gates apply to entering the Game preset, never to ordinary BP actions. */
export function playerIdentityIssues(state: MatchState): GamePreflightIssue[] {
  const zh = state.language === 'zh', issues: GamePreflightIssue[] = [];
  const ids = sides.flatMap(side => state[`${side}Team`].players.map(name => typeof name === 'string' ? playerIdentity(name) : ''));
  if (ids.length !== 10 || ids.some(id => !id) || new Set(ids).size !== 10) issues.push({
    code: 'player_ids', message: zh ? '请填写十名选手的非空且不重复 ID。' : 'Enter ten nonempty, unique player IDs.',
  });
  if (sides.some(side => {
    const assigned = state[`${side}Team`].playerRoles;
    return assigned.length !== 5 || new Set(assigned).size !== 5 || assigned.some(role => !roles.includes(role));
  })) issues.push({code: 'player_roles', message: zh ? '请为双方各设置完整且不重复的五个分路。' : 'Assign all five distinct roles on each team.'});
  return issues;
}

export function gamePreflightIssues(state: MatchState): GamePreflightIssue[] {
  const zh = state.language === 'zh', issues = playerIdentityIssues(state);
  const unverified = sides.filter(side => !isPlayerSlotVerified(state, side));
  if (unverified.length) issues.push({
    code: 'player_order', message: zh ? '请在选手 ID 面板核验双方 P1–P5，并等待服务器确认。' : 'Verify both teams’ P1–P5 in Player IDs and wait for server confirmation.',
  });
  if (!state.draftComplete) issues.push({code: 'draft', message: zh ? '请先完成本局选禁。' : 'Complete the current draft first.'});
  const lineups = sides.flatMap(side => state[`${side}Assignments`]);
  const legal = sides.every(side => {
    const picks = state[`${side}Picks`], lineup = state[`${side}Assignments`];
    return picks.length === 5 && lineup.length === 5
      && lineup.every((hero, slot) => hero !== null && Number.isInteger(hero) && heroAllowed(state.heroPool, hero)
        && picks.includes(hero) && !pickRestriction(state, side, slot, hero));
  }) && lineups.length === 10 && lineups.every(hero => hero !== null)
    && new Set(lineups.map(hero => draftHeroGroupKey(state, hero!))).size === 10;
  if (!legal) issues.push({code: 'lineup', message: zh ? '请核对并保存双方完整、合法的最终英雄归属。' : 'Save complete, valid final hero assignments for both teams.'});
  if (state.draftGameNumber !== null && state.draftGameNumber !== state.gameNumber) issues.push({
    code: 'current_game', message: zh ? '比分已进入下一局，请先进入下一局并重新核验。' : 'The score has advanced. Start the next game and verify its lineup.',
  });
  if (state.committedGameId) {
    const record = state.draftHistory.find(game => game.id === state.committedGameId);
    const consistent = record && record.gameNumber === (state.draftGameNumber ?? state.gameNumber) && sides.every(side => {
      const team = record[`${side}Team`], current = state[`${side}Team`];
      return team.id === current.id && JSON.stringify([team.players, team.playerRoles, record[`${side}PlayerSlotOrder`], record[`${side}Assignments`]])
        === JSON.stringify([current.players, current.playerRoles, state[`${side}PlayerSlotOrder`], state[`${side}Assignments`]]);
    });
    if (!consistent && !issues.some(issue => issue.code === 'current_game')) issues.push({
      code: 'current_game', message: zh ? '当前名单或阵容与已提交本局不一致，请核对本局记录。' : 'The current roster or lineup differs from the committed game. Review the saved game.',
    });
  }
  return issues;
}

export function validateGameReady(state: MatchState): {ready: boolean; issues: GamePreflightIssue[]} {
  const issues = gamePreflightIssues(state);
  return {ready: issues.length === 0, issues};
}
