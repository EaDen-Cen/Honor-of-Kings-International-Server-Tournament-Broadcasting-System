import { normalizePlayerSlotOrder, playerAtSlot } from './playerSlots.js';
import { allPoolHeroes } from './heroPool.js';
import { initialState, type GameDraftRecord, type MatchState, type Side, type Team } from './types.js';
import { defaultBansForMode as defaultBanCount } from './heroPool.js';

export const playerIdentity = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
export const seriesWins = (state: MatchState) => (Number(state.seriesFormat.slice(2)) + 1) / 2;
export const seriesFinished = (state: MatchState) => Math.max(state.blueScore, state.redScore) >= seriesWins(state);
export const ruleLocked = (state: MatchState) => state.currentPhase > 0 || state.draftHistory.length > 0;
export const currentGame = (state: MatchState) => state.draftGameNumber ?? state.gameNumber;
export const displaySides = (state: MatchState): [Side, Side] => [state.displayLeftSide, state.displayLeftSide === 'blue' ? 'red' : 'blue'];

const heroById = new Map(allPoolHeroes.map(hero => [hero.id, hero]));

export function draftHeroGroupKey(state: Pick<MatchState, 'flowbornFormsIndependent'>, heroId: number) {
  const hero = heroById.get(heroId);
  if (!state.flowbornFormsIndependent && hero?.variantGroup === 'flowborn') return 'variant:flowborn';
  return `hero:${heroId}`;
}

export function sameDraftHero(state: Pick<MatchState, 'flowbornFormsIndependent'>, leftId: number, rightId: number) {
  return draftHeroGroupKey(state, leftId) === draftHeroGroupKey(state, rightId);
}

export function draftHeroUsed(state: MatchState, heroId: number) {
  return [...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks]
    .some(id => id !== null && sameDraftHero(state, id, heroId));
}

function historyIncludesHero(state: MatchState, ids: number[], heroId: number) {
  return ids.some(id => sameDraftHero(state, id, heroId));
}

export function historyForTeam(record: GameDraftRecord, teamId: string) {
  if (record.blueTeam.id === teamId) return { team: record.blueTeam, bans: record.blueBans ?? [], picks: record.bluePicks, assignments: record.blueAssignments, playerSlotOrder: normalizePlayerSlotOrder(record.bluePlayerSlotOrder) };
  if (record.redTeam.id === teamId) return { team: record.redTeam, bans: record.redBans ?? [], picks: record.redPicks, assignments: record.redAssignments, playerSlotOrder: normalizePlayerSlotOrder(record.redPlayerSlotOrder) };
  return undefined;
}

/** Current-game bans/duplicates are checked separately. History never consumes ban slots. */
export function pickRestriction(state: MatchState, side: Side, playerIndex: number, heroId: number): 'playerMissing' | 'usedByPlayer' | 'usedByTeam' | undefined {
  if (state.draftRuleMode === 'normal') return;
  const team = state[`${side}Team`];
  if (state.draftRuleMode === 'global') {
    if (state.draftHistory.some(record => {
      const picks = historyForTeam(record, team.id)?.picks ?? [];
      return record.id !== state.committedGameId && historyIncludesHero(state, picks, heroId);
    })) return 'usedByTeam';
    return;
  }
  const identity = playerIdentity(playerAtSlot(state, side, playerIndex).id);
  if (!identity) return 'playerMissing';
  // Identity follows the person when a substitute changes slots or a team changes sides.
  if (state.draftHistory.some(record => record.id !== state.committedGameId && (['blue', 'red'] as const).some(recordSide =>
    record[`${recordSide}Team`].players.some((player, index) => {
      const slot = normalizePlayerSlotOrder(record[`${recordSide}PlayerSlotOrder`]).indexOf(index);
      const assigned = record[`${recordSide}Assignments`][slot];
      return playerIdentity(player) === identity && sameDraftHero(state, assigned, heroId);
    })))) return 'usedByPlayer';
}

/** Avoid spending a ban on a hero the opposing team cannot reuse in Global BP. */
export function banRestriction(state: MatchState, side: Side, heroId: number): 'opponentAlreadyUsed' | undefined {
  if (state.draftRuleMode !== 'global') return;
  const opponent = state[side === 'blue' ? 'redTeam' : 'blueTeam'];
  if (state.draftHistory.some(record => {
    const picks = historyForTeam(record, opponent.id)?.picks ?? [];
    return record.id !== state.committedGameId && historyIncludesHero(state, picks, heroId);
  })) return 'opponentAlreadyUsed';
}

export function draftRestriction(state: MatchState, side: Side, action: 'ban' | 'pick', heroId: number) {
  if (action === 'ban') return banRestriction(state, side, heroId);
  if (state.draftRuleMode !== 'player') return pickRestriction(state, side, state[`${side}Picks`].length, heroId);

  // Help-picks mean draft order is not player ownership. During the draft a hero
  // is legal if at least one player on the team can still own it; final ownership
  // is validated atomically from assignments before commit.
  const reasons = state[`${side}Team`].players.map((_, index) => pickRestriction(state, side, index, heroId));
  if (reasons.some(reason => !reason)) return undefined;
  return reasons.includes('playerMissing') ? 'playerMissing' : 'usedByPlayer';
}

/** Upgrade every saved snapshot, including undo and delayed events. Never infer history from picks. */
export function normalizeState(raw: MatchState): MatchState {
  const defaults = initialState();
  const normalizeTeam = (team: Partial<Team> | undefined, side: Side): Team => {
    const fallback = defaults[`${side}Team`];
    return { ...fallback, ...team, id: team?.id || fallback.id,
      players: Array.from({ length: 5 }, (_, i) => team?.players?.[i] ?? ''),
      playerRoles: Array.from({ length: 5 }, (_, i) => team?.playerRoles?.[i] ?? fallback.playerRoles[i]),
      playerPortraits: Array.from({ length: 5 }, (_, i) => team?.playerPortraits?.[i] ?? ''),
    };
  };
  const normalizeAssignments = (value: Array<number | null> | undefined, picks: number[]) =>
    Array.from({ length: 5 }, (_, index) => value?.[index] ?? picks[index] ?? null);
  const state = { ...defaults, ...raw,
    bluePlayerSlotOrder: normalizePlayerSlotOrder(raw.bluePlayerSlotOrder),
    redPlayerSlotOrder: normalizePlayerSlotOrder(raw.redPlayerSlotOrder),
    blueTeam: normalizeTeam(raw.blueTeam, 'blue'), redTeam: normalizeTeam(raw.redTeam, 'red'),
    blueAssignments: normalizeAssignments(raw.blueAssignments, raw.bluePicks ?? []),
    redAssignments: normalizeAssignments(raw.redAssignments, raw.redPicks ?? []),
    showHeroName: raw.showHeroName ?? true,
    artSourceMode: raw.artSourceMode ?? 'auto',
    heroArtOverrides: raw.heroArtOverrides ?? {},
    heroDataOverrides: raw.heroDataOverrides ?? {},
    draftHistory: (raw.draftHistory ?? []).map(record => ({ ...record,
      bluePlayerSlotOrder: normalizePlayerSlotOrder(record.bluePlayerSlotOrder),
      redPlayerSlotOrder: normalizePlayerSlotOrder(record.redPlayerSlotOrder),
      firstPickSide: record.firstPickSide ?? 'blue',
      blueTeam: normalizeTeam(record.blueTeam, 'blue'), redTeam: normalizeTeam(record.redTeam, 'red'),
      blueBans: [...(record.blueBans ?? [])],
      redBans: [...(record.redBans ?? [])],
      blueAssignments: [...(record.blueAssignments ?? record.bluePicks)],
      redAssignments: [...(record.redAssignments ?? record.redPicks)],
    })),
  };
  // Old archives use independent games. Upgrading must not silently impose Global BP.
  state.draftRuleMode = raw.draftRuleMode ?? 'normal';
  state.flowbornFormsIndependent = raw.flowbornFormsIndependent ?? true;
  state.displayLeftSide = raw.displayLeftSide ?? 'blue';
  state.firstPickSide = raw.firstPickSide ?? 'blue';
  state.heroPool = raw.heroPool === 'cn' ? 'cn' : 'global';
  if(state.heroPool==='cn')state.recognitionAutoAccept=false;
  state.banCount = Number.isInteger(raw.banCount)&&raw.banCount>=0&&raw.banCount<=5 ? raw.banCount : defaultBanCount(raw.draftMode);
  state.draftHistory=state.draftHistory.map(record=>({...record,heroPool:record.heroPool??'global',banCount:record.banCount??defaultBanCount(raw.draftMode)}));
  state.sideSwapMode = raw.sideSwapMode ?? 'moveTeams';
  state.draftGameNumber = raw.draftGameNumber ?? (raw.currentPhase > 0 ? raw.gameNumber : null);
  return state;
}
