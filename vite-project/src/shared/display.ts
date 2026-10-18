import { phases, type Language, type MatchState, type Side } from './types.js';
import { translate, type MessageKey } from './i18n.js';

export const sideLabel = (side: Side, lang: Language) => translate(lang, side === 'blue' ? 'blueSide' : 'redSide');

// Team names and player IDs are user data, never translation keys.
export const teamName = (state: MatchState, side: Side) => state[`${side}Team`].name;
export const draftRuleName = (state: MatchState, lang = state.language) => translate(lang, ({ normal: 'ruleNormal', player: 'rulePlayer', global: 'ruleGlobal' } as const)[state.draftRuleMode]);

const stages: Record<string, MessageKey> = {
  'COMMUNITY TOURNAMENT': 'stageCommunity', '社区赛事': 'stageCommunity',
  'Group Stage': 'stageGroup', '小组赛': 'stageGroup',
  Quarterfinal: 'stageQuarter', '四分之一决赛': 'stageQuarter',
  Semifinal: 'stageSemi', '半决赛': 'stageSemi',
  Final: 'stageFinal', '决赛': 'stageFinal',
  'Grand Final': 'stageGrandFinal', '总决赛': 'stageGrandFinal',
};
export const stageName = (value: string, lang: Language) => stages[value] ? translate(lang, stages[value]) : value;
export const seriesName = (value: MatchState['seriesFormat'], lang: Language) => translate(lang, ({ BO1: 'bo1', BO3: 'bo3', BO5: 'bo5' } as const)[value]);
export const phaseName = (state: MatchState, lang = state.language) => {
  const phase = phases(state.draftMode, state.firstPickSide, state.banCount)[state.currentPhase];
  return phase ? translate(lang, phase.action === 'ban' ? 'banHero' : 'pickHero', { team: teamName(state, phase.team) }) : translate(lang, 'draftComplete');
};

const laneKeys: Record<string, MessageKey> = {
  all: 'all', 'Clash Lane': 'clash', Jungling: 'jungle',
  'Mid Lane': 'mid', 'Farm Lane': 'farm', Roaming: 'roam',
};
export const lanes = Object.keys(laneKeys);
export const laneName = (lane: string, lang: Language) => translate(lang, laneKeys[lane]);

const connectionKeys: Record<string, MessageKey> = {
  Connecting: 'statusConnecting', Connected: 'statusConnected', Reconnecting: 'statusReconnecting',
  'Access token required': 'statusTokenRequired', 'Invalid token': 'statusInvalidToken',
  'Access rejected': 'statusRejected',
};
export const connectionLabel = (status: string, lang: Language) => translate(lang, connectionKeys[status] || 'statusUnavailable');
