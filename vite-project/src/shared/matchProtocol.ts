import type { Snapshot } from './types.js';
import {postGameGrades} from './postGame.js';

type Check = (value: unknown) => boolean;
const text: Check = value => typeof value === 'string';
const number: Check = value => typeof value === 'number' && Number.isFinite(value);
const integer: Check = value => number(value) && Number.isSafeInteger(value) && (value as number) >= 0;
const boolean: Check = value => typeof value === 'boolean';
const optional = (check: Check): Check => value => value === undefined || check(value);
const nullable = (check: Check): Check => value => value === null || check(value);
const choices = (...values: unknown[]): Check => value => values.includes(value);
const list = (check: Check): Check => value => Array.isArray(value) && value.every(check);
const object = (fields: Record<string, Check>): Check => value => isObject(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const record = (check: Check): Check => value => isObject(value) && Object.values(value).every(check);
const side = choices('blue', 'red');
const role = choices('clash', 'jungle', 'mid', 'farm', 'roam');
const hero = integer;
const slots = list(nullable(hero));
const playerOrder = list(integer);
const team = object({ id: text, name: text, logo: text, players: list(text), playerRoles: optional(list(role)), playerPortraits: optional(list(text)) });
const crop = object({ x: number, y: number, scale: number });
const field = object({ value: number, sourcePage: text, confidence: number, manual: boolean, evidence: optional(text), capturedAt: optional(number), resolution: optional(number) });
const grade = object({value:choices(...postGameGrades),sourcePage:choices('summary'),confidence:number,manual:boolean,evidence:optional(text),capturedAt:optional(number)});
const difference = object({points:list(object({timeSeconds:integer,difference:number})),source:choices('settlement','manual'),confidence:number,maxDifference:number,evidence:optional(text),capturedAt:optional(number),partial:optional(boolean),durationSeconds:optional(integer)});
const timeline = list(object({ timeSeconds: number, blueGold: number, redGold: number }));
const history = object({
  id: text, gameNumber: integer, committedAt: number, firstPickSide: optional(side),
  heroPool: optional(choices('global', 'cn')), banCount: optional(integer),
  blueTeam: team, redTeam: team,
  bluePicks: list(hero), redPicks: list(hero),
  blueBans: optional(slots), redBans: optional(slots),
  blueAssignments: optional(list(hero)), redAssignments: optional(list(hero)),
  bluePlayerSlotOrder: optional(playerOrder), redPlayerSlotOrder: optional(playerOrder),
});
const report = object({
  id: text, gameNumber: integer, seriesFormat: choices('BO1', 'BO3', 'BO5'), stage: text,
  selectedMvpPlayerId: nullable(text), selectedMvpRowId: nullable(text),
  teamFields: optional(record(record(field))), goldTimeline: optional(timeline),goldDifference:optional(difference),mvpArtScale:optional(number),
  players: list(object({ rowId: text, playerId: text, side, slot: integer, rosterIndex: integer, teamName: text, portrait: text, role, heroId: hero, fields: record(field),grade:optional(grade) })),
});
const liveStats = object({
  blueKills: number, redKills: number, blueTowers: number, redTowers: number,
  blueGold: optional(number), redGold: optional(number), gameTimeSeconds: optional(number),
  density: choices('compact', 'full'),
  neutralObjectives: list(object({ id: text, name: text, icon: text, blue: number, red: number })),
  sources: optional(record(object({ source: choices('manual', 'ocr'), capturedAt: number, confidence: number }))),
});
const state = object({
  blueTeam: team, redTeam: team, blueScore: integer, redScore: integer, gameNumber: integer,
  seriesFormat: choices('BO1', 'BO3', 'BO5'), stage: text, language: choices('zh', 'eng'), overlayLayout: choices('panel', 'side'),
  draftMode: choices('match', 'normal'), currentPhase: integer, draftComplete: boolean,
  blueBans: slots, redBans: slots, bluePicks: list(hero), redPicks: list(hero),
  // Fields introduced after the original draft protocol remain optional so an
  // older backend can still display its upgrade notice without crashing.
  blueAssignments: optional(slots), redAssignments: optional(slots),
  bluePlayerSlotOrder: optional(playerOrder), redPlayerSlotOrder: optional(playerOrder),
  heroPool: optional(choices('global', 'cn')), banCount: optional(integer),
  displayLeftSide: optional(side), firstPickSide: optional(side), sideSwapMode: optional(choices('moveTeams', 'colorsOnly')),
  draftRuleMode: optional(choices('normal', 'player', 'global')), flowbornFormsIndependent: optional(boolean),
  draftHistory: optional(list(history)), draftGameNumber: optional(nullable(integer)), committedGameId: optional(nullable(text)),
  scoreDisplay: optional(choices('number', 'boxes')), bpInputMode: optional(choices('manual', 'screen')),
  recognitionAutoAccept: optional(boolean), recognitionThreshold: optional(number), showHeroName: optional(boolean),
  artSourceMode: optional(choices('auto', 'legacy')),
  heroArtOverrides: optional(record(object({ useLegacyImage: optional(boolean), panel: optional(crop), side: optional(crop) }))),
  heroDataOverrides: optional(record(object({ englishName: optional(text), chineseName: optional(text), occupation: optional(text), altOccupation: optional(text), aliases: optional(list(text)), imageLink: optional(text), artLink: optional(text) }))),
  liveGameStats: optional(liveStats), postGameReports: optional(list(report)), activePostGameReportId: optional(nullable(text)),
});

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Keep malformed HTTP and socket payloads outside React's render path. */
export function isMatchSnapshot(value: unknown): value is Snapshot {
  return object({ type: choices('match_state_update'), revision: integer, state, casterDelaySeconds: optional(number), canUndo: optional(boolean) })(value);
}

export type MatchMessage = Snapshot
  | { type: 'access_token_update'; token: string }
  | { type: 'ack'; id: string; revision?: number }
  | { type: 'error'; id?: string; error: string }
  | { type: 'pong' };

export function parseMatchMessage(data: unknown): MatchMessage | undefined {
  if (typeof data !== 'string') return;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return; }
  if (!isObject(value)) return;
  if (value.type === 'match_state_update') return isMatchSnapshot(value) ? value : undefined;
  if (value.type === 'access_token_update' && typeof value.token === 'string' && value.token.trim()) return { type: value.type, token: value.token };
  if (value.type === 'ack' && typeof value.id === 'string' && value.id && optional(integer)(value.revision)) return { type: value.type, id: value.id, ...(value.revision === undefined ? {} : { revision: value.revision as number }) };
  if (value.type === 'error' && typeof value.error === 'string' && (value.id === undefined || typeof value.id === 'string')) return { type: value.type, error: value.error, id: value.id };
  if (value.type === 'pong') return { type: value.type };
}

let actionSequence = 0;
export function createMatchActionId(): string {
  // randomUUID requires a secure context; LAN operators also use plain HTTP.
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `action-${Date.now().toString(36)}-${(++actionSequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
