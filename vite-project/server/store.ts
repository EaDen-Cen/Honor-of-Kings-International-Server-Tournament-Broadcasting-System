import { canMergePostGameField } from '../src/shared/postGame.js';
import { validGoldTimeline } from '../src/shared/postGameTimeline.js';
import { validatePostGameField, validatePostGameGrade, validatePostGameCurve } from './postGameValidation.js';
import { liveCaptureKeys, type LiveCaptureKey } from '../src/shared/gameCapture.js';
import { normalizePlayerSlotOrder } from '../src/shared/playerSlots.js';
import { nextLiveGameStats, liveGameContext, trustedLiveUpdates } from '../src/shared/liveGame.js';
import { validPlayerSlotOrder } from '../src/shared/playerSlots.js';
import { existsSync, mkdirSync, readFileSync, renameSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import type { TeamPresetStore } from './teamPresets.js';
import { dirname } from 'node:path';
import { allPoolHeroes, heroAllowed, isBanCount, defaultBansForMode } from '../src/shared/heroPool.js';
import { migrateLegacyHeroId, migrateLegacyHeroIdRecord } from '../src/data/heroIdOrder.js';
import { initialState, phases, type Action, type GameDraftRecord, type MatchState, type Role, type Snapshot } from '../src/shared/types.js';
import { currentGame, draftHeroGroupKey, draftHeroUsed, draftRestriction, normalizeState, pickRestriction, playerIdentity, ruleLocked, seriesFinished } from '../src/shared/draftRules.js';
import { draftTurnAtPhase } from '../src/shared/draftTurns.js';

interface Event { id: string; timestamp: number; type: string; resultingState: MatchState; revision: number }
interface Data { version: 2; state: MatchState; events: Event[]; history: MatchState[]; revision: number; delay: number; ids: string[] }
interface LegacyData extends Omit<Data, 'version'> { version: 1 }
const copy = <T>(v: T): T => structuredClone(v);
const savedObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function validateSavedData(input: unknown): asserts input is Data | LegacyData {
  const invalid = () => new Error('比赛存档无效，请恢复有效备份');
  if (!savedObject(input) || input.version !== 1 && input.version !== 2 ||
    !savedObject(input.state) || !Array.isArray(input.history) || input.history.some(state => !savedObject(state)) ||
    !Array.isArray(input.events) || !Array.isArray(input.ids) || input.ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(id)) || new Set(input.ids).size !== input.ids.length ||
    !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 ||
    !Number.isInteger(input.delay) || Number(input.delay) < 0 || Number(input.delay) > 3600) throw invalid();
  let previousTimestamp = -1, previousRevision = 0;
  for (const event of input.events) {
    if (!savedObject(event) || typeof event.id !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(event.id) || typeof event.type !== 'string' ||
      !savedObject(event.resultingState) || !Number.isSafeInteger(event.timestamp) || Number(event.timestamp) < 0 || Number(event.timestamp) < previousTimestamp ||
      !Number.isSafeInteger(event.revision) || Number(event.revision) <= previousRevision || Number(event.revision) > Number(input.revision)) throw invalid();
    previousTimestamp = Number(event.timestamp);
    previousRevision = Number(event.revision);
  }
}

function remapHeroIds(values: Array<number | null> | undefined) {
  return (values || []).map(value => migrateLegacyHeroId(value) as number | null);
}

function migrateStateHeroIds(input: MatchState): MatchState {
  const state = copy(input);
  state.blueBans = remapHeroIds(state.blueBans);
  state.redBans = remapHeroIds(state.redBans);
  state.bluePicks = remapHeroIds(state.bluePicks) as number[];
  state.redPicks = remapHeroIds(state.redPicks) as number[];
  state.blueAssignments = remapHeroIds(state.blueAssignments);
  state.redAssignments = remapHeroIds(state.redAssignments);
  state.heroArtOverrides = migrateLegacyHeroIdRecord(state.heroArtOverrides || {});
  state.heroDataOverrides = migrateLegacyHeroIdRecord(state.heroDataOverrides || {});

  state.draftHistory = (state.draftHistory || []).map(game => ({
    ...game,
    blueBans: remapHeroIds(game.blueBans),
    redBans: remapHeroIds(game.redBans),
    bluePicks: remapHeroIds(game.bluePicks) as number[],
    redPicks: remapHeroIds(game.redPicks) as number[],
    blueAssignments: remapHeroIds(game.blueAssignments) as number[],
    redAssignments: remapHeroIds(game.redAssignments) as number[],
  }));

  state.postGameReports = (state.postGameReports || []).map(report => ({
    ...report,
    players: report.players.map(player => ({
      ...player,
      heroId: migrateLegacyHeroId(player.heroId) as number,
    })),
  }));
  return state;
}

function migrateLegacyData(data: LegacyData): Data {
  return {
    ...data,
    version: 2,
    state: migrateStateHeroIds(data.state),
    history: data.history.map(migrateStateHeroIds),
    events: data.events.map(event => ({
      ...event,
      resultingState: migrateStateHeroIds(event.resultingState),
    })),
  };
}
function integer(v: unknown, min: number, max: number): asserts v is number {
  if (!Number.isInteger(v) || Number(v) < min || Number(v) > max) throw new Error(`请输入 ${min} 至 ${max} 之间的整数`);
}
function shortText(v: unknown, max: number): asserts v is string {
  if (typeof v !== 'string' || v.length > max) throw new Error(`文字格式不正确，最多可输入 ${max} 个字符`);
}
function validateArtCrop(crop: unknown) {
  if (!crop || typeof crop !== 'object') throw new Error('heroArtCropInvalid');
  const value = crop as { x?: unknown; y?: unknown; scale?: unknown };
  if (typeof value.x !== 'number' || !Number.isFinite(value.x) || value.x < 0 || value.x > 100) throw new Error('heroArtCropInvalid');
  if (typeof value.y !== 'number' || !Number.isFinite(value.y) || value.y < 0 || value.y > 100) throw new Error('heroArtCropInvalid');
  if (typeof value.scale !== 'number' || !Number.isFinite(value.scale) || value.scale < 1 || value.scale > 3) throw new Error('heroArtCropInvalid');
}
export function portraitURL(value: unknown): asserts value is string {
  shortText(value, 1000);
  if (!value) return;
  if (/\s|\\/.test(value) || [...value].some(char => char.charCodeAt(0) < 32)) throw new Error('portraitInvalid');
  if (/^\/(?!\/)/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return;
  } catch { /* Reject invalid URLs below. */ }
  throw new Error('portraitInvalid');
}
function clearDraft(state: MatchState) {
  state.liveGameStats = nextLiveGameStats(state.liveGameStats);
  Object.assign(state, {
    bluePlayerSlotOrder: [0,1,2,3,4], redPlayerSlotOrder: [0,1,2,3,4],
    blueBans: [], redBans: [], bluePicks: [], redPicks: [],
    blueAssignments: [null, null, null, null, null],
    redAssignments: [null, null, null, null, null],
    currentPhase: 0, draftComplete: false, draftGameNumber: null, committedGameId: null,
  });
}
function validateScores(blue: number, red: number, format: MatchState['seriesFormat']) {
  integer(blue, 0, 3); integer(red, 0, 3);
  const wins = (Number(format.slice(2)) + 1) / 2;
  if (blue > wins || red > wins || (blue === wins && red === wins)) throw new Error('比分或局数不符合当前赛制');
}
function casterViewState(current: MatchState, delayed?: MatchState): MatchState {
  const view = copy(delayed ?? initialState());

  // Team/tournament metadata is not gameplay-sensitive. Keep it live so the
  // caster desk is useful immediately, while picks, bans, scores and history
  // continue to follow the configured caster delay.
  view.blueTeam = copy(current.blueTeam);
  view.redTeam = copy(current.redTeam);
  view.seriesFormat = current.seriesFormat;
  view.stage = current.stage;
  view.language = current.language;
  view.overlayLayout = current.overlayLayout;
  view.scoreDisplay = current.scoreDisplay;
  view.bpInputMode = current.bpInputMode;
  view.showHeroName = current.showHeroName;
  view.artSourceMode = current.artSourceMode;
  view.heroArtOverrides = copy(current.heroArtOverrides || {});
  view.heroDataOverrides = copy(current.heroDataOverrides || {});
  view.draftMode = current.draftMode;
  view.firstPickSide = current.firstPickSide;
  view.sideSwapMode = current.sideSwapMode;
  view.draftRuleMode = current.draftRuleMode;
  view.flowbornFormsIndependent = current.flowbornFormsIndependent;
  return view;
}
function validateLineup(state: MatchState, requireComplete = state.draftComplete) {
  for (const side of ['blue', 'red'] as const) {
    const picks = state[`${side}Picks`];
    const assignments = state[`${side}Assignments`];
    if (!Array.isArray(assignments) || assignments.length !== 5) throw new Error('lineupInvalid');
    const assigned = assignments.filter((heroId): heroId is number => heroId !== null);
    if (new Set(assigned.map(heroId => draftHeroGroupKey(state, heroId))).size !== assigned.length || assigned.some(heroId => !picks.includes(heroId))) throw new Error('lineupInvalid');
    if (requireComplete) {
      if (picks.length !== 5 || assigned.length !== 5 || picks.some(heroId => !assigned.includes(heroId))) throw new Error('lineupIncomplete');
      if (state.draftRuleMode === 'player') {
        assignments.forEach((heroId, index) => {
          if (heroId === null) throw new Error('lineupIncomplete');
          const reason = pickRestriction(state, side, index, heroId);
          if (reason) throw new Error(reason);
        });
      }
    }
  }
}
/** Create an empty report only once; never wipe earlier game data. */
function preparePostGameReport(state: MatchState, game: GameDraftRecord) {
  if(!state.postGameReports.some(report=>report.id===game.id))state.postGameReports.push({id:game.id,gameNumber:game.gameNumber,seriesFormat:state.seriesFormat,stage:state.stage,selectedMvpPlayerId:null,selectedMvpRowId:null,players:(['blue','red'] as const).flatMap(side=>game[`${side}Assignments`].map((heroId,slot)=>{
        const team=game[`${side}Team`],rosterIndex=normalizePlayerSlotOrder(game[`${side}PlayerSlotOrder`])[slot];
        return {rowId:`${team.id}:${rosterIndex}`,playerId:team.players[rosterIndex],side,slot,rosterIndex,teamName:team.name,portrait:team.playerPortraits[rosterIndex],role:team.playerRoles[rosterIndex],heroId,fields:{}};
      }))})
}

export class Store {
  data: Data;
  constructor(private file?: string, private clock = Date.now, private presets?: TeamPresetStore) {
    let loaded: Data | LegacyData | undefined;
    if (file && existsSync(file)) {
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
      catch (cause) { throw new Error('比赛存档无效，请恢复有效备份', { cause }); }
      validateSavedData(parsed);
      loaded = parsed;
    }
    this.data = loaded !== undefined
      ? loaded.version === 1 ? migrateLegacyData(loaded) : loaded
      : { version: 2, state: initialState(), events: [], history: [], revision: 0, delay: 180, ids: [] };
    this.data.state = normalizeState(this.data.state);
    this.data.history = this.data.history.map(normalizeState);
    this.data.events = this.data.events.map(event => ({ ...event, resultingState: normalizeState(event.resultingState) }));
  }
  private delayedEvent() {
    const cutoff = this.clock() - this.data.delay * 1000;
    let low = 0, high = this.data.events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.data.events[middle].timestamp <= cutoff) low = middle + 1;
      else high = middle;
    }
    return this.data.events[low - 1];
  }
  snapshotVersion(role: Role) {
    return `${this.data.revision}:${role === 'caster' ? this.delayedEvent()?.revision ?? 0 : 0}`;
  }
  snapshot(role: Role): Snapshot {
    if (role === 'caster') {
      const event = this.delayedEvent();

      return {
        type: 'match_state_update',
        state: casterViewState(this.data.state, event?.resultingState),
        revision: event?.revision ?? 0,
        casterDelaySeconds: this.data.delay,
      };
    }

    return {
      type: 'match_state_update',
      state: copy(this.data.state),
      revision: this.data.revision,
      ...(role === 'control'
        ? {
          casterDelaySeconds: this.data.delay,
          canUndo: this.data.history.length > 0,
        }
        : {}),
    };
  }
  apply(id: string, revision: number, action: Action) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(id)) throw new Error('操作编号无效，请刷新页面后重试');
    if (this.data.ids.includes(id)) return;
    if (revision !== this.data.revision) throw new Error('比赛状态已更新，请确认当前选禁结果后重试');
    if (!action || typeof action !== 'object') throw new Error('操作无效');
    const next = copy(this.data);
    const state = next.state;
    switch (action.type) {
    case 'post_game_begin': {
      const gameId=action.gameId??state.committedGameId??state.draftHistory.at(-1)?.id;
      const game=state.draftHistory.find(record=>record.id===gameId);
      if(!game)throw new Error('先确认有效局阵容 / Commit the game first');
      next.history.push(copy(state));state.activePostGameReportId=game.id;
      preparePostGameReport(state, game);;
      break;
    }
    case 'post_game_fields': {
      const report=state.postGameReports.find(r=>r.id===action.reportId);
      if(!report||!Array.isArray(action.updates)||!action.updates.length&&!action.grades?.length||action.updates.length>100)throw new Error('赛后报告无效 / Invalid post-game report');
      if(action.grades!==undefined){
        if(!Array.isArray(action.grades)||action.grades.length>10)throw new Error('Invalid grade report');
        for(const {rowId,field} of action.grades){
          if(!report.players.some(p=>p.rowId===rowId))throw new Error('Invalid game grade');
          validatePostGameGrade(field);
        }
      }
      for(const update of action.updates){
        if(!report.players.some(p=>p.rowId===update.rowId))throw new Error('赛后字段无效 / Invalid post-game field');
        validatePostGameField(update.metric, update.field, 'player');
      }
      next.history.push(copy(state));
      for(const update of action.updates){const field=update.field,player=report.players.find(p=>p.rowId===update.rowId)!;if(!canMergePostGameField(player.fields[update.metric],field))continue;player.fields[update.metric]={value:field.value,confidence:field.confidence,manual:field.manual,sourcePage:field.sourcePage,...(field.resolution?{resolution:field.resolution}:{}),...(field.evidence?{evidence:field.evidence}:{}),...(field.capturedAt!==undefined?{capturedAt:field.capturedAt}:{})};}
      for(const {rowId,field} of action.grades??[]){
        const player=report.players.find(p=>p.rowId===rowId)!,old=player.grade;
        if(field.manual||!old||!old.manual&&(old.confidence<.85||old.value===field.value)&&field.confidence>=old.confidence)player.grade={value:field.value,sourcePage:'summary',confidence:field.confidence,manual:field.manual,...(field.evidence?{evidence:field.evidence}:{}),...(field.capturedAt!==undefined?{capturedAt:field.capturedAt}:{})};
      }
      break;
    }
    case 'post_game_mvp_art_scale': {
      const report=state.postGameReports.find(r=>r.id===action.reportId);
      if(!report||typeof action.scale!=='number'||!Number.isFinite(action.scale)||action.scale<1||action.scale>2)throw new Error('Invalid MVP image scale');
      next.history.push(copy(state));report.mvpArtScale=action.scale;
      break;
    }
    case 'post_game_grades': {
      const report=state.postGameReports.find(r=>r.id===action.reportId);
      if(!report||!Array.isArray(action.updates)||!action.updates.length||action.updates.length>10)throw new Error('Invalid grade report');
      for(const {rowId,field} of action.updates){
        if(!report.players.some(p=>p.rowId===rowId))throw new Error('Invalid game grade');
        validatePostGameGrade(field);
      }
      next.history.push(copy(state));
      for(const {rowId,field} of action.updates){
        const player=report.players.find(p=>p.rowId===rowId)!,old=player.grade;
        if(field.manual||!old||!old.manual&&(old.confidence<.85||old.value===field.value)&&field.confidence>=old.confidence)player.grade={value:field.value,sourcePage:'summary',confidence:field.confidence,manual:field.manual,...(field.evidence?{evidence:field.evidence}:{}),...(field.capturedAt!==undefined?{capturedAt:field.capturedAt}:{})};
      }
      break;
    }
    case 'post_game_team_fields': {
      const report=state.postGameReports.find(r=>r.id===action.reportId);
      if(!report||!Array.isArray(action.updates)||!action.updates.length&&!action.goldDifference||action.updates.length>20)throw new Error('Invalid team report');
      if(action.goldDifference!==undefined)validatePostGameCurve(action.goldDifference);
      for(const {side,metric,field} of action.updates){
        if(!['blue','red'].includes(side))throw new Error('Invalid team field');
        validatePostGameField(metric, field, 'team');
      }
      next.history.push(copy(state));
      report.teamFields??={};
      for(const {side,metric,field} of action.updates){
        const fields=report.teamFields[side]??={};
        if(canMergePostGameField(fields[metric],field))fields[metric]={value:field.value,sourcePage:'recap',manual:field.manual,confidence:field.confidence,...(field.evidence?{evidence:field.evidence}:{}),...(field.capturedAt!==undefined?{capturedAt:field.capturedAt}:{})};
      }
      const curve=action.goldDifference;
      if(curve&&(curve.source==='manual'||!report.goldDifference||report.goldDifference.source!=='manual'&&!(curve.partial&&!report.goldDifference.partial)&&(curve.confidence>=report.goldDifference.confidence||report.goldDifference.partial&&!curve.partial)))report.goldDifference={points:curve.points.map(p=>({timeSeconds:p.timeSeconds,difference:p.difference})),source:curve.source,confidence:curve.confidence,maxDifference:curve.maxDifference,...(curve.partial?{partial:true}:{}),...(curve.durationSeconds!==undefined?{durationSeconds:curve.durationSeconds}:{}),...(curve.evidence?{evidence:curve.evidence}:{}),...(curve.capturedAt!==undefined?{capturedAt:curve.capturedAt}:{})};
      break;
    }
    case 'post_game_gold_timeline': {
      const report=state.postGameReports.find(r=>r.id===action.reportId);
      if(!report||!validGoldTimeline(action.points))throw new Error('Invalid gold time-series; use verified, increasing replay samples');
      next.history.push(copy(state));
      report.goldTimeline=action.points.map(point=>({timeSeconds:point.timeSeconds,blueGold:point.blueGold,redGold:point.redGold}));
      const differencePoints=action.points.map(point=>({timeSeconds:point.timeSeconds,difference:point.blueGold-point.redGold}));
      report.goldDifference={points:differencePoints,source:'manual',confidence:1,maxDifference:Math.max(1,...differencePoints.map(point=>Math.abs(point.difference)))};
      break;
    }
    case 'select_mvp': {
      const report=state.postGameReports.find(r=>r.id===action.reportId),player=report?.players.find(p=>p.rowId===action.rowId);
      if(!report||(action.rowId!==null&&!player))throw new Error('MVP 选手无效 / Invalid MVP player');
      next.history.push(copy(state));state.activePostGameReportId=report.id;
      report.selectedMvpRowId=player?.rowId??null;report.selectedMvpPlayerId=player?.playerId??null;
      break;
    }
    case 'live_game_freeze': {
      if(!liveCaptureKeys.includes(action.key)||typeof action.frozen!=='boolean')throw new Error('Invalid HUD field');
      next.history.push(copy(state));
      const sources={...state.liveGameStats.sources};
      if(action.frozen)sources[action.key]={source:'manual',confidence:1,capturedAt:this.clock()};else delete sources[action.key];
      state.liveGameStats.sources=sources;
      break;
    }
    case 'live_game_ocr': {
      if(action.context!==liveGameContext(state))throw new Error('Game changed; capture again');
      for(const sample of [action.previous,action.sample]){
        if(!sample||!Array.isArray(sample.candidates)||sample.candidates.length!==7||new Set(sample.candidates.map(c=>c.key)).size!==7)throw new Error('Invalid HUD sample');
        integer(sample.capturedAt,0,this.clock());
        if(this.clock()-sample.capturedAt>30000)throw new Error('HUD sample expired');
        for(const c of sample.candidates)if(!liveCaptureKeys.includes(c.key)||c.value!==null&&(typeof c.value!=='number'||!Number.isFinite(c.value))||typeof c.confidence!=='number'||!Number.isFinite(c.confidence)||c.confidence<0||c.confidence>1)throw new Error('Invalid HUD candidate');
      }
      const updates=trustedLiveUpdates(state.liveGameStats,action.previous,action.sample);
      if(!Object.keys(updates).length)throw new Error('No consistent unfrozen HUD fields; capture again or use manual input');
      next.history.push(copy(state));next.history=next.history.slice(-200);
      const stats=state.liveGameStats,sources={...stats.sources};
      for(const [key,value] of Object.entries(updates)){
        stats[key as LiveCaptureKey]=value;
        sources[key as LiveCaptureKey]={source:'ocr',capturedAt:action.sample.capturedAt,confidence:action.sample.candidates.find(c=>c.key===key)!.confidence};
      }
      stats.sources=sources;
      break;
    }
    case 'live_game_stats': {
      const stats=action.stats;
      if(!stats || !['compact','full'].includes(stats.density) || !Array.isArray(stats.neutralObjectives) || stats.neutralObjectives.length>6) throw new Error('局内统计格式无效 / Invalid live stats');
      for(const value of [stats.blueKills,stats.redKills,stats.blueTowers,stats.redTowers]) integer(value,0,999);
      if(stats.widthPercent!==undefined)integer(stats.widthPercent,50,100);
      if(stats.heightPx!==undefined)integer(stats.heightPx,64,200);
      for(const key of ['blueGold','redGold','gameTimeSeconds'] as const)if(stats[key]!==undefined)integer(stats[key],0,key==='gameTimeSeconds'?7200:1000000);
      for(const item of stats.neutralObjectives){shortText(item.id,100);shortText(item.name,24);if(!item.id||!item.name.trim())throw new Error('资源名称不能为空 / Objective name required');portraitURL(item.icon);integer(item.blue,0,999);integer(item.red,0,999);if(item.status!==undefined&&!['alive','down','unknown'].includes(item.status))throw new Error('Invalid objective status');}
      if(new Set(stats.neutralObjectives.map(item=>item.id)).size!==stats.neutralObjectives.length)throw new Error('资源编号重复 / Duplicate objective ID');
      next.history.push(copy(state));
      const sources={...state.liveGameStats.sources};
      for(const key of liveCaptureKeys)if(stats[key]!==state.liveGameStats[key])sources[key]={source:'manual',capturedAt:this.clock(),confidence:1};
      state.liveGameStats={blueKills:stats.blueKills,redKills:stats.redKills,blueTowers:stats.blueTowers,redTowers:stats.redTowers,blueGold:stats.blueGold,redGold:stats.redGold,gameTimeSeconds:stats.gameTimeSeconds,sources,density:stats.density,widthPercent:stats.widthPercent??65,heightPx:stats.heightPx??132,neutralObjectives:stats.neutralObjectives.map(item=>({id:item.id,name:item.name.trim(),icon:item.icon,blue:item.blue,red:item.red,status:item.status??'unknown'}))};
      break;
    }

    case 'load_team_preset': {
      if (state.currentPhase !== 0 || state.draftHistory.length || state.committedGameId) throw new Error('presetLocked');
      if (!['blue', 'red'].includes(action.side)) throw new Error('presetInvalid');
      const preset = this.presets?.get(action.presetId);
      if (!preset) throw new Error('presetMissing');
      const other = state[action.side === 'blue' ? 'redTeam' : 'blueTeam'];
      if (other.id === preset.id) throw new Error('presetDuplicate');
      if (state.draftRuleMode === 'player') {
        const ids = [...other.players, ...preset.players].map(playerIdentity).filter(Boolean);
        if (new Set(ids).size !== ids.length) throw new Error('duplicatePlayerIds');
      }
      next.history.push(copy(state));
      state[`${action.side}PlayerSlotOrder`] = [0,1,2,3,4];
      state[action.side === 'blue' ? 'blueTeam' : 'redTeam'] = { id: preset.id, name: preset.name, logo: preset.logo, players: [...preset.players], playerRoles: [...preset.playerRoles], playerPortraits: [...preset.playerPortraits] };
      break;
    }
    case 'draft_pick_group': {
      if (state.committedGameId) throw new Error('gameAlreadyCommitted');
      if (state.draftRuleMode === 'player' && [...state.blueTeam.players, ...state.redTeam.players].some(player => !playerIdentity(player))) throw new Error('playerMissing');
      if (state.currentPhase === 0 && (seriesFinished(state) || state.draftHistory.some(game => game.gameNumber >= state.gameNumber))) throw new Error('updateScoreBeforeNext');
      const turn = draftTurnAtPhase(state.draftMode, state.firstPickSide, state.currentPhase,state.banCount);
      if (!turn || turn.action !== 'pick' || turn.team !== action.team) throw new Error('当前选禁阶段不支持此操作，请确认轮次和队伍');
      if (!Array.isArray(action.heroIds) || action.heroIds.length !== turn.phaseIndexes.length || action.heroIds.length < 1 || action.heroIds.length > 2) throw new Error('pickGroupInvalid');
      next.history.push(copy(state));
      state.draftGameNumber ??= state.gameNumber;
      for (const heroId of action.heroIds) {
        const phase = phases(state.draftMode, state.firstPickSide,state.banCount)[state.currentPhase];
        if (!phase || phase.action !== 'pick' || phase.team !== action.team) throw new Error('pickGroupInvalid');
        if (!heroAllowed(state.heroPool,heroId)) throw new Error('heroNotInPool');
        if (draftHeroUsed(state, heroId)) {
          const selected = [...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks]
            .find(id => id !== null && draftHeroGroupKey(state, id) === draftHeroGroupKey(state, heroId));
          const groupedFlowborn = !state.flowbornFormsIndependent && selected !== undefined && selected !== heroId;
          throw new Error(groupedFlowborn ? 'flowbornAlreadyUsed' : '该英雄已被选择或禁用');
        }
        const reason = draftRestriction(state, phase.team, 'pick', heroId);
        if (reason) throw new Error(reason);
        state[`${phase.team}Picks`].push(heroId);
        const assignmentIndex = state[`${phase.team}Picks`].length - 1;
        state[`${phase.team}Assignments`][assignmentIndex] = heroId;
        state.currentPhase++;
      }
      state.draftComplete = state.currentPhase === phases(state.draftMode, state.firstPickSide,state.banCount).length;
      break;
    }
    case 'replace_draft_hero': {
      if (!['blue', 'red'].includes(action.team) || !['ban', 'pick'].includes(action.action)) throw new Error('操作无效');
      const record = action.gameId
        ? state.draftHistory.find(game => game.id === action.gameId)
        : state.committedGameId
          ? state.draftHistory.find(game => game.id === state.committedGameId)
          : undefined;
      if (action.gameId && !record) throw new Error('无法找到指定历史局 / Unknown game');
      // No gameId means the current live draft, including the just-committed game.
      const live = !action.gameId || action.gameId === state.committedGameId;
      const target = live ? state : record!;
      const targetPool = live ? state.heroPool : (record?.heroPool ?? 'global');
      if (!heroAllowed(targetPool, action.heroId)) throw new Error('heroNotInPool');
      const selections = action.action === 'ban'
        ? target[`${action.team}Bans`] ?? []
        : target[`${action.team}Picks`];
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= selections.length) throw new Error('未找到已锁定的英雄槽位 / Locked slot not found');
      const previous = selections[action.index];
      if (previous === action.heroId) break;
      const occupied = (['blue', 'red'] as const).flatMap(team => [
        ...(target[`${team}Bans`] ?? []).filter((_, index) => action.action !== 'ban' || team !== action.team || index !== action.index),
        ...target[`${team}Picks`].filter((_, index) => action.action !== 'pick' || team !== action.team || index !== action.index),
      ]).filter((id): id is number => id !== null);
      if (occupied.some(id => draftHeroGroupKey(state, id) === draftHeroGroupKey(state, action.heroId))) throw new Error('该英雄已被选择或禁用');
      next.history.push(copy(state));
      const replace = (game: MatchState | typeof record) => {
        if (!game) return;
        if (action.action === 'ban') {
          const bans = game[`${action.team}Bans`];
          if (bans) bans[action.index] = action.heroId;
          return;
        }
        game[`${action.team}Picks`][action.index] = action.heroId;
        const assignments = game[`${action.team}Assignments`];
        for (let index = 0; index < assignments.length; index++) {
          if (assignments[index] === previous) assignments[index] = action.heroId;
        }
      };
      if (live) {
        replace(state);
        if (record) replace(record);
        if (state.draftComplete) validateLineup(state, true);
      } else replace(record);
      // Post-game identities follow the corrected committed lineup; numeric fields
      // and manually entered scores must never be erased by a BP correction.
      if (record && action.action === 'pick') {
        const report = state.postGameReports.find(item => item.id === record.id);
        if (report) for (const player of report.players) {
          if (player.side === action.team) player.heroId = record[`${action.team}Assignments`][player.slot];
        }
      }
      break;
    }
    case 'draft_action': {
      if (state.committedGameId) throw new Error('gameAlreadyCommitted');
      if (state.draftRuleMode === 'player' && [...state.blueTeam.players, ...state.redTeam.players].some(player => !playerIdentity(player))) throw new Error('playerMissing');
      if (state.currentPhase === 0 && (seriesFinished(state) || state.draftHistory.some(game => game.gameNumber >= state.gameNumber))) throw new Error('updateScoreBeforeNext');
      const phase = phases(state.draftMode, state.firstPickSide,state.banCount)[state.currentPhase];
      if (!phase || phase.team !== action.team || phase.action !== action.action) throw new Error('当前选禁阶段不支持此操作，请确认轮次和队伍');
      if (!heroAllowed(state.heroPool,action.heroId)) throw new Error('heroNotInPool');
      if (draftHeroUsed(state, action.heroId)) {
        const selected = [...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks]
          .find(id => id !== null && draftHeroGroupKey(state, id) === draftHeroGroupKey(state, action.heroId));
        const groupedFlowborn = !state.flowbornFormsIndependent && selected !== undefined && selected !== action.heroId;
        throw new Error(groupedFlowborn ? 'flowbornAlreadyUsed' : '该英雄已被选择或禁用');
      }
      const reason = draftRestriction(state, phase.team, phase.action, action.heroId);
      if (reason) throw new Error(reason);
      next.history.push(copy(state));
      state.draftGameNumber ??= state.gameNumber;
      state[`${phase.team}${phase.action === 'ban' ? 'Bans' : 'Picks'}`].push(action.heroId);
      if (phase.action === 'pick') {
        const assignmentIndex = state[`${phase.team}Picks`].length - 1;
        state[`${phase.team}Assignments`][assignmentIndex] = action.heroId;
      }
      state.currentPhase++;
      state.draftComplete = state.currentPhase === phases(state.draftMode, state.firstPickSide,state.banCount).length;
      break;
    }
    case 'skip_ban': {
      if (state.committedGameId) throw new Error('gameAlreadyCommitted');
      if (state.draftRuleMode === 'player' && [...state.blueTeam.players, ...state.redTeam.players].some(player => !playerIdentity(player))) throw new Error('playerMissing');
      if (state.currentPhase === 0 && (seriesFinished(state) || state.draftHistory.some(game => game.gameNumber >= state.gameNumber))) throw new Error('updateScoreBeforeNext');
      const phase = phases(state.draftMode, state.firstPickSide,state.banCount)[state.currentPhase];
      if (!phase || phase.team !== action.team || phase.action !== 'ban') throw new Error('emptyBanOnlyDuringBan');
      next.history.push(copy(state));
      state.draftGameNumber ??= state.gameNumber;
      state[`${phase.team}Bans`].push(null);
      state.currentPhase++;
      state.draftComplete = state.currentPhase === phases(state.draftMode, state.firstPickSide,state.banCount).length;
      break;
    }
    case 'commit_game': {
      if (state.committedGameId || state.draftHistory.some(game => game.gameNumber === currentGame(state))) throw new Error('gameAlreadyCommitted');
      if (!state.draftComplete || state.bluePicks.length !== 5 || state.redPicks.length !== 5) throw new Error('completeDraftFirst');
      validateLineup(state, true);
      next.history.push(copy(state));
      state.draftHistory.push({
        id, firstPickSide: state.firstPickSide, heroPool:state.heroPool,banCount:state.banCount,gameNumber: currentGame(state), committedAt: this.clock(),
        blueTeam: copy(state.blueTeam), redTeam: copy(state.redTeam),
        bluePlayerSlotOrder: [...state.bluePlayerSlotOrder], redPlayerSlotOrder: [...state.redPlayerSlotOrder],
        blueBans: [...state.blueBans], redBans: [...state.redBans],
        bluePicks: [...state.bluePicks], redPicks: [...state.redPicks],
        blueAssignments: [...state.blueAssignments] as number[],
        redAssignments: [...state.redAssignments] as number[],
      });
      state.committedGameId = id;
      // Make Game 2 active on commit, without deleting Game 1 fields.
      preparePostGameReport(state, state.draftHistory[state.draftHistory.length - 1]);
      state.activePostGameReportId = id;
      break;
    }
    case 'next_game': {
      if (!state.committedGameId) throw new Error('commitBeforeNext');
      if (seriesFinished(state)) throw new Error('seriesHasEnded');
      if (state.gameNumber !== currentGame(state) + 1) throw new Error('updateScoreBeforeNext');
      next.history.push(copy(state)); clearDraft(state); break;
    }
    case 'swap_sides': {
      if (state.currentPhase > 0 || state.committedGameId) throw new Error('swapOnlyBetweenGames');
      next.history.push(copy(state));
      [state.bluePlayerSlotOrder, state.redPlayerSlotOrder] = [state.redPlayerSlotOrder, state.bluePlayerSlotOrder];
      [state.blueTeam, state.redTeam] = [state.redTeam, state.blueTeam];
      [state.blueScore, state.redScore] = [state.redScore, state.blueScore];
      if (state.sideSwapMode === 'colorsOnly') state.displayLeftSide = state.displayLeftSide === 'blue' ? 'red' : 'blue';
      break;
    }
    case 'swap_picks':
    case 'swap_assignments': {
      if (state.committedGameId) throw new Error('gameAlreadyCommitted');
      if (!state.draftComplete) throw new Error('completeDraftFirst');
      if (!['blue', 'red'].includes(action.team)) throw new Error('操作无效');
      integer(action.from, 0, 4); integer(action.to, 0, 4);
      next.history.push(copy(state));
      const assignments = state[`${action.team}Assignments`];
      [assignments[action.from], assignments[action.to]] = [assignments[action.to], assignments[action.from]];
      validateLineup(state, true);
      break;
    }
    case 'set_player_slot_orders': {
      if (state.committedGameId) throw new Error('gameAlreadyCommitted');
      if (!validPlayerSlotOrder(action.blue) || !validPlayerSlotOrder(action.red)) throw new Error('选手顺序必须包含五名不同选手 / Invalid player order');
      if (JSON.stringify(action.expectedPlayers) !== JSON.stringify([state.blueTeam.players,state.redTeam.players])) throw new Error('阵容已改变，请重新识别 / Roster changed; scan again');
      next.history.push(copy(state));
      state.bluePlayerSlotOrder = [...action.blue];
      state.redPlayerSlotOrder = [...action.red];
      if (state.draftComplete) validateLineup(state, true);
      break;
    }
    case 'set_player_slot_order': {
      if (state.committedGameId) throw new Error('gameAlreadyCommitted');
      if (!['blue','red'].includes(action.side) || !validPlayerSlotOrder(action.order)) throw new Error('选手顺序必须包含五名不同选手 / Invalid player order');
      if (JSON.stringify(action.expectedPlayers) !== JSON.stringify(state[`${action.side}Team`].players)) throw new Error('阵容已改变，请重新识别 / Roster changed; scan again');
      next.history.push(copy(state));
      state[`${action.side}PlayerSlotOrder`] = [...action.order];
      if (state.draftComplete) validateLineup(state, true);
      break;
    }
    case 'set_lineup_assignments': {
      if (state.committedGameId) throw new Error('gameAlreadyCommitted');
      if (!state.draftComplete) throw new Error('completeDraftFirst');
      for (const lineup of [action.blue, action.red]) {
        if (!Array.isArray(lineup) || lineup.length !== 5 || lineup.some(heroId => !Number.isInteger(heroId))) throw new Error('lineupInvalid');
      }
      next.history.push(copy(state));
      state.blueAssignments = [...action.blue];
      state.redAssignments = [...action.red];
      validateLineup(state, true);
      break;
    }
    case 'score': {
      if (!['blue', 'red'].includes(action.team) || ![1, -1].includes(action.delta)) throw new Error('操作无效');
      next.history.push(copy(state));
      state[`${action.team}Score`] += action.delta;
      validateScores(state.blueScore, state.redScore, state.seriesFormat);
      state.gameNumber = Math.min(state.blueScore + state.redScore + 1, Number(state.seriesFormat.slice(2)));
      break;
    }
    case 'undo': {
      const previous = next.history.pop();
      if (!previous) throw new Error('没有可以撤销的操作');
      next.state = previous;
      break;
    }
    case 'reset_draft':
      if (state.committedGameId) throw new Error('committedDraftReset');
      next.history.push(copy(state));
      clearDraft(state);
      break;
    case 'reset_match': {
      next.history.push(copy(state));
      const reset = initialState();

      // Reset match progress but preserve tournament configuration. This mirrors
      // the proven LoL workflow: clearing a match should not force the director
      // to rebuild event identity, BO format, BP rules or presentation settings.
      reset.liveGameStats = nextLiveGameStats(state.liveGameStats);
      reset.stage = state.stage;
      reset.seriesFormat = state.seriesFormat;
      reset.draftMode = state.draftMode;
      reset.draftRuleMode = state.draftRuleMode;
      reset.flowbornFormsIndependent = state.flowbornFormsIndependent;
      reset.heroPool = state.heroPool;
      reset.banCount = state.banCount;
      reset.firstPickSide = state.firstPickSide;
      reset.sideSwapMode = state.sideSwapMode;
      reset.language = state.language;
      reset.overlayLayout = state.overlayLayout;
      reset.scoreDisplay = state.scoreDisplay;
      reset.bpInputMode = state.bpInputMode;
      reset.recognitionAutoAccept = state.recognitionAutoAccept;
      reset.recognitionThreshold = state.recognitionThreshold;

      reset.heroArtOverrides = copy(state.heroArtOverrides || {});
      reset.heroDataOverrides = copy(state.heroDataOverrides || {});
      reset.showHeroName = state.showHeroName ?? true;
      reset.artSourceMode = state.artSourceMode ?? 'auto';
      next.state = reset;
      break;
    }
    case 'settings': {
      const s = action.settings;
      if (
        !s ||
        !['BO1', 'BO3', 'BO5'].includes(s.seriesFormat) ||
        !['match', 'normal'].includes(s.draftMode) ||
        !['normal', 'player', 'global'].includes(s.draftRuleMode ?? state.draftRuleMode) ||
        !['blue', 'red'].includes(s.firstPickSide ?? state.firstPickSide) ||
        !['moveTeams', 'colorsOnly'].includes(s.sideSwapMode ?? state.sideSwapMode) ||
        !['zh', 'eng'].includes(s.language) ||
        !['panel', 'side'].includes(s.overlayLayout) ||
        !['number', 'boxes'].includes(s.scoreDisplay ?? state.scoreDisplay ?? 'number') ||
        !['manual', 'screen'].includes(s.bpInputMode ?? state.bpInputMode ?? 'manual') ||
        typeof (s.showHeroName ?? state.showHeroName) !== 'boolean' ||
        typeof (s.flowbornFormsIndependent ?? state.flowbornFormsIndependent) !== 'boolean' ||
        !['auto', 'legacy'].includes(s.artSourceMode ?? state.artSourceMode ?? 'auto')
      ) {
        throw new Error('比赛设置无效，请检查赛制、语言和画面布局');
      }
      if (s.recognitionAutoAccept !== undefined && typeof s.recognitionAutoAccept !== 'boolean') throw new Error('Invalid automatic recognition setting');
      if (s.recognitionThreshold !== undefined) integer(s.recognitionThreshold, 50, 100);
      integer(s.blueScore, 0, 3); integer(s.redScore, 0, 3); integer(s.gameNumber, 1, 5);
      const wins = (Number(s.seriesFormat.slice(2)) + 1) / 2;
      if (s.blueScore > wins || s.redScore > wins || (s.blueScore === wins && s.redScore === wins) || s.gameNumber > Number(s.seriesFormat.slice(2))) throw new Error('比分或局数不符合当前赛制');
      shortText(s.stage, 80);
      const draftRuleMode = s.draftRuleMode ?? state.draftRuleMode;
      const heroPool=s.heroPool??state.heroPool;
      const banCount=s.banCount??defaultBansForMode(s.draftMode);
      if(!['cn','global'].includes(heroPool)||!isBanCount(banCount))throw new Error('Invalid hero pool or bans per team');
      const firstPickSide = s.firstPickSide ?? state.firstPickSide;
      const flowbornFormsIndependent = s.flowbornFormsIndependent ?? state.flowbornFormsIndependent;
      if (state.currentPhase > 0 && firstPickSide !== state.firstPickSide) throw new Error('firstPickLocked');
      if (ruleLocked(state) && (draftRuleMode !== state.draftRuleMode || flowbornFormsIndependent !== state.flowbornFormsIndependent || heroPool!==state.heroPool || banCount!==state.banCount)) throw new Error('rulesLocked');
      if (state.draftHistory.length && s.seriesFormat !== state.seriesFormat) throw new Error('rulesLocked');
      for (const team of [s.blueTeam, s.redTeam]) {
        if (!team) throw new Error('请填写队伍信息');

        shortText(team.name, 60);
        portraitURL(team.logo);

        if (!Array.isArray(team.players) || team.players.length !== 5) {
          throw new Error('每支队伍必须填写 5 个选手位置');
        }

        if (!Array.isArray(team.playerRoles) || team.playerRoles.length !== 5) {
          throw new Error('每支队伍必须设置 5 个选手分路');
        }
        if (team.playerPortraits !== undefined) {
          if (!Array.isArray(team.playerPortraits) || team.playerPortraits.length !== 5) throw new Error('portraitsInvalid');
          team.playerPortraits.forEach(portraitURL);
        }

        const validRoles = ['clash', 'jungle', 'mid', 'farm', 'roam'];

        for (const role of team.playerRoles) {
          if (!validRoles.includes(role)) {
            throw new Error('选手分路无效');
          }
        }

        for (const player of team.players) {
          shortText(player, 40);
        }

        if (!team.name.trim()) {
          throw new Error('队伍名称不能为空');
        }

      }
      if (draftRuleMode === 'player') {
        const identities = [...s.blueTeam.players, ...s.redTeam.players].map(playerIdentity).filter(Boolean);
        if (new Set(identities).size !== identities.length) throw new Error('duplicatePlayerIds');
      }
      if (state.currentPhase > 0 && s.draftMode !== state.draftMode) throw new Error('请先重置选禁，再修改选禁赛制');
      next.history.push(copy(state));
      Object.assign(state, {
        blueTeam: {
          id: state.blueTeam.id,
          name: s.blueTeam.name,
          logo: s.blueTeam.logo,
          players: [...s.blueTeam.players],
          playerRoles: [...s.blueTeam.playerRoles],
          playerPortraits: [...(s.blueTeam.playerPortraits ?? state.blueTeam.playerPortraits)],
        },
        redTeam: {
          id: state.redTeam.id,
          name: s.redTeam.name,
          logo: s.redTeam.logo,
          players: [...s.redTeam.players],
          playerRoles: [...s.redTeam.playerRoles],
          playerPortraits: [...(s.redTeam.playerPortraits ?? state.redTeam.playerPortraits)],
        },

        blueScore: s.blueScore,
        redScore: s.redScore,

        gameNumber: Math.min(
          s.blueScore + s.redScore + 1,
          Number(s.seriesFormat.slice(2))
        ),
        seriesFormat: s.seriesFormat,
        stage: s.stage,

        language: s.language,
        overlayLayout: s.overlayLayout,
        scoreDisplay: s.scoreDisplay ?? state.scoreDisplay ?? 'number',
        bpInputMode: s.bpInputMode ?? state.bpInputMode ?? 'manual',
        recognitionAutoAccept: heroPool==='cn'?false:(s.recognitionAutoAccept ?? state.recognitionAutoAccept ?? false),
        recognitionThreshold: s.recognitionThreshold ?? state.recognitionThreshold ?? 90,
        showHeroName: s.showHeroName ?? state.showHeroName ?? true,
        artSourceMode: s.artSourceMode ?? state.artSourceMode ?? 'auto',

        draftMode: s.draftMode,
        heroPool,banCount,
        draftRuleMode,
        flowbornFormsIndependent,
        firstPickSide,
        sideSwapMode: s.sideSwapMode ?? state.sideSwapMode,
      });
      // Live roster corrections must respect the incoming player’s previous picks.
      // Committed records remain immutable snapshots of the game already played.
      if (state.currentPhase > 0 && !state.committedGameId) {
        if (state.draftRuleMode === 'player' && [...state.blueTeam.players, ...state.redTeam.players].some(player => !playerIdentity(player))) throw new Error('playerMissing');
        if (state.draftComplete) validateLineup(state, true);
      }
      break;
    }
    case 'hero_art_override': {
      if (!allPoolHeroes.some(hero => hero.id === action.heroId)) throw new Error('找不到该英雄');
      const override = action.override;
      if (!override || typeof override !== 'object') throw new Error('heroArtOverrideInvalid');
      if (override.useLegacyImage !== undefined && typeof override.useLegacyImage !== 'boolean') throw new Error('heroArtOverrideInvalid');
      if (override.panel !== undefined) validateArtCrop(override.panel);
      if (override.side !== undefined) validateArtCrop(override.side);
      next.history.push(copy(state));
      state.heroArtOverrides = { ...(state.heroArtOverrides || {}), [String(action.heroId)]: copy(override) };
      break;
    }
    case 'hero_data_override': {
      const baseHero = allPoolHeroes.find(hero => hero.id === action.heroId);
      if (!baseHero) throw new Error('找不到该英雄');
      const override = action.override;
      if (!override || typeof override !== 'object') throw new Error('heroDataOverrideInvalid');
      if (override.englishName !== undefined) { shortText(override.englishName, 60); if (!override.englishName.trim()) throw new Error('heroDataOverrideInvalid'); }
      if (override.chineseName !== undefined) { shortText(override.chineseName, 60); if (!override.chineseName.trim()) throw new Error('heroDataOverrideInvalid'); }
      const validLanes = ['', 'Clash Lane', 'Jungling', 'Mid Lane', 'Farm Lane', 'Roaming'];
      if (override.occupation !== undefined && !validLanes.includes(override.occupation)) throw new Error('heroDataOverrideInvalid');
      if (override.altOccupation !== undefined && !validLanes.includes(override.altOccupation)) throw new Error('heroDataOverrideInvalid');
      if (override.aliases !== undefined) {
        if (!Array.isArray(override.aliases) || override.aliases.length > 20) throw new Error('heroDataOverrideInvalid');
        override.aliases.forEach(alias => shortText(alias, 60));
      }
      if (override.imageLink !== undefined) {
        if (!override.imageLink.trim()) throw new Error('heroDataOverrideInvalid');
        portraitURL(override.imageLink);
      }
      if (override.artLink !== undefined) {
        if (!override.artLink.trim()) throw new Error('heroDataOverrideInvalid');
        portraitURL(override.artLink);
      }

      // Persist only fields that differ from the generated roster baseline.
      // This keeps future hero-data syncs free to update fields the director
      // never actually overrode.
      const normalized: typeof override = {};
      if (override.englishName !== undefined && override.englishName.trim() !== baseHero.englishName) normalized.englishName = override.englishName.trim();
      if (override.chineseName !== undefined && override.chineseName.trim() !== baseHero.chineseName) normalized.chineseName = override.chineseName.trim();
      if (override.occupation !== undefined && override.occupation !== baseHero.occupation) normalized.occupation = override.occupation;
      if (override.altOccupation !== undefined && override.altOccupation !== (baseHero.altOccupation ?? '')) normalized.altOccupation = override.altOccupation;
      if (override.aliases !== undefined) {
        const aliases = [...new Set(override.aliases.map(alias => alias.trim()).filter(Boolean))];
        if (JSON.stringify(aliases) !== JSON.stringify(baseHero.aliases ?? [])) normalized.aliases = aliases;
      }
      if (override.imageLink !== undefined && override.imageLink !== baseHero.imageLink) normalized.imageLink = override.imageLink;
      if (override.artLink !== undefined && override.artLink !== (baseHero.artLink ?? '')) normalized.artLink = override.artLink;

      next.history.push(copy(state));
      const map = { ...(state.heroDataOverrides || {}) };
      if (Object.keys(normalized).length) map[String(action.heroId)] = copy(normalized);
      else delete map[String(action.heroId)];
      state.heroDataOverrides = map;
      break;
    }
    case 'reset_hero_data_override': {
      if (!allPoolHeroes.some(hero => hero.id === action.heroId)) throw new Error('找不到该英雄');
      next.history.push(copy(state));
      const map = { ...(state.heroDataOverrides || {}) };
      delete map[String(action.heroId)];
      state.heroDataOverrides = map;
      break;
    }
    case 'reset_hero_art_override': {
      if (!allPoolHeroes.some(hero => hero.id === action.heroId)) throw new Error('找不到该英雄');
      next.history.push(copy(state));
      const key = String(action.heroId);
      const current = { ...(state.heroArtOverrides?.[key] || {}) };
      if (action.layout) {
        if (!['panel', 'side'].includes(action.layout)) throw new Error('heroArtOverrideInvalid');
        delete current[action.layout];
        if (current.useLegacyImage === undefined && current.panel === undefined && current.side === undefined) {
          const map = { ...(state.heroArtOverrides || {}) };
          delete map[key];
          state.heroArtOverrides = map;
        } else {
          state.heroArtOverrides = { ...(state.heroArtOverrides || {}), [key]: current };
        }
      } else {
        const map = { ...(state.heroArtOverrides || {}) };
        delete map[key];
        state.heroArtOverrides = map;
      }
      break;
    }
    case 'delay': integer(action.seconds, 0, 3600); next.delay = action.seconds; break;
    default: throw new Error('不支持此操作');
    }
    next.revision++;
    if (action.type !== 'delay') next.events.push({ id, timestamp: Math.max(this.clock(), next.events.at(-1)?.timestamp ?? 0), type: action.type, resultingState: copy(next.state), revision: next.revision });
    if(action.type==='live_game_ocr'){
      // Preserve the delayed baseline and every recent sample, without keeping
      // a full-match snapshot for each automatic HUD poll for hours.
      const cutoff=this.clock()-3600*1000,lastOld=next.events.findLastIndex(event=>event.timestamp<=cutoff);
      next.events=next.events.filter((event,index)=>event.type!=='live_game_ocr'||event.timestamp>cutoff||index===lastOld);
    }
    next.ids = [...next.ids.slice(-999), id];
    // Commit durable state before acknowledging or broadcasting. Failure leaves memory unchanged.
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const temporary = `${this.file}.tmp`;
        const fd = openSync(temporary, 'w');
        try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temporary, this.file);
      } catch (cause) {
        throw new Error('比赛状态保存失败，本次操作未生效，请联系导播检查服务器存储后重试', { cause });
      }
    }
    this.data = next;
  }
}
