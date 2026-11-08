import type { MatchState, GameDraftRecord, GameRules, SeriesRules, SeriesFormat } from './types.js';
import { isBanCount } from './heroPool.js';

export const seriesFormats: SeriesFormat[] = ['BO1', 'BO3', 'BO5', 'BO7'];
export const maximumGames = (format: SeriesFormat) => Number(format.slice(2));
export function legacyGameRules(state: MatchState, record?: GameDraftRecord): GameRules {
  return {
    mode: state.draftMode,
    heroPool: record?.heroPool ?? state.heroPool,
    banCount: record?.banCount ?? state.banCount,
    draftRuleMode: state.draftRuleMode,
    enforcePreviousHistory: true,
    contributeToFutureHistory: true,
    recordHeroes: true,
    requireLineupConfirmation: false,
    firstPickSide: record?.firstPickSide ?? state.firstPickSide,
    sideSwapMode: state.sideSwapMode,
    flowbornFormsIndependent: state.flowbornFormsIndependent,
  };
}
export function gameRulesFor(state: MatchState, gameNumber: number): GameRules {
  const plan = state.seriesRules;
  return plan
    ? { ...plan.defaultGameRules, ...plan.games[String(gameNumber)] }
    : legacyGameRules(state);
}
export function gameRulesLocked(state: MatchState, gameNumber: number) {
  const current = state.draftGameNumber ?? state.gameNumber;
  return (
    state.draftHistory.some((game) => game.gameNumber === gameNumber) ||
    gameNumber < current ||
    (gameNumber === current && (state.currentPhase > 0 || !!state.committedGameId))
  );
}
const fields = [
  'mode',
  'heroPool',
  'banCount',
  'draftRuleMode',
  'enforcePreviousHistory',
  'contributeToFutureHistory',
  'recordHeroes',
  'requireLineupConfirmation',
  'firstPickSide',
  'sideSwapMode',
  'flowbornFormsIndependent',
] as const;
export function validateGameRules(input: unknown): asserts input is GameRules {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid game rules');
  const r = input as GameRules;
  if (
    Object.keys(r).some((key) => !(fields as readonly string[]).includes(key)) ||
    !['match', 'normal', 'blind'].includes(r.mode) ||
    !['global', 'cn'].includes(r.heroPool) ||
    !isBanCount(r.banCount) ||
    !['normal', 'player', 'global'].includes(r.draftRuleMode) ||
    !['blue', 'red'].includes(r.firstPickSide) ||
    !['moveTeams', 'colorsOnly'].includes(r.sideSwapMode) ||
    [
      'enforcePreviousHistory',
      'contributeToFutureHistory',
      'recordHeroes',
      'requireLineupConfirmation',
      'flowbornFormsIndependent',
    ].some((key) => typeof r[key as keyof GameRules] !== 'boolean') ||
    (r.mode === 'blind' && (r.banCount !== 0 || r.requireLineupConfirmation)) ||
    (!r.recordHeroes && r.contributeToFutureHistory) ||
    (r.mode !== 'blind' && !r.recordHeroes)
  )
    throw Error('Invalid game rules / 盲选须零 Ban；不记录英雄不能贡献历史');
}
export function validateSeriesRules(
  input: unknown,
  format: SeriesFormat,
): asserts input is SeriesRules {
  if (
    !seriesFormats.includes(format) ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  )
    throw Error('Invalid series rules');
  const plan = input as SeriesRules;
  validateGameRules(plan.defaultGameRules);
  if (
    Object.keys(plan).some((key) => !['defaultGameRules', 'games'].includes(key)) ||
    !plan.games ||
    typeof plan.games !== 'object' ||
    Array.isArray(plan.games)
  )
    throw Error('Invalid rules plan');
  for (const [key, override] of Object.entries(plan.games)) {
    if (
      !/^[1-7]$/.test(key) ||
      Number(key) > maximumGames(format) ||
      !override ||
      typeof override !== 'object' ||
      Array.isArray(override)
    )
      throw Error('Invalid game override');
    validateGameRules({ ...plan.defaultGameRules, ...override });
  }
}
export function sameGameRules(a: GameRules, b: GameRules) {
  return fields.every((key) => a[key] === b[key]);
}
export function applyGameRules(
  state: MatchState,
  rules = gameRulesFor(state, state.draftGameNumber ?? state.gameNumber),
) {
  validateGameRules(rules);
  state.currentGameRules = structuredClone(rules);
  state.draftMode = rules.mode;
  for (const key of [
    'heroPool',
    'banCount',
    'draftRuleMode',
    'firstPickSide',
    'sideSwapMode',
    'flowbornFormsIndependent',
  ] as const) {
    Object.assign(state, { [key]: rules[key] });
  }
  if (rules.heroPool === 'cn' || rules.mode === 'blind') state.recognitionAutoAccept = false;
}
export function getEligibleHistoryGames(
  state: MatchState,
  rules = state.currentGameRules ?? legacyGameRules(state),
) {
  if (!rules.enforcePreviousHistory) return [];
  const current = state.draftGameNumber ?? state.gameNumber;
  return state.draftHistory.filter(
    (record) =>
      record.id !== state.committedGameId &&
      record.gameNumber < current &&
      (record.rules?.recordHeroes ?? true) &&
      (record.rules?.contributeToFutureHistory ?? true),
  );
}
