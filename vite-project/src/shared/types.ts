import type { PostGameReport, PostGameMetric, PostGameField, PostGameTeamMetric, PostGameGradeField } from './postGame.js';
import { initialLiveGameStats, type LiveGameStats, type LiveHudSample } from './liveGame.js';
import type { LiveCaptureKey } from './gameCapture.js';
import type { GoldTimelinePoint,GoldDifferenceTimeline } from './postGameTimeline.js';
import { defaultBansForMode, type HeroPool, type BanCount } from './heroPool.js';
export type Side = 'blue' | 'red';

export type Language = 'zh' | 'eng';

export type OverlayLayout = 'panel' | 'side';
export type HeroArtLayout = OverlayLayout;
export interface HeroArtCrop { x: number; y: number; scale: number }
export interface HeroArtOverride {
  useLegacyImage?: boolean;
  panel?: HeroArtCrop;
  side?: HeroArtCrop;
}
export interface HeroDataOverride {
  englishName?: string;
  chineseName?: string;
  occupation?: string;
  altOccupation?: string;
  aliases?: string[];
  /** Optional per-match/local tournament portrait source. HTTPS or absolute local path. */
  imageLink?: string;
  /** Optional per-match/local tournament full-art source. HTTPS or absolute local path. */
  artLink?: string;
}
export type DraftRuleMode = 'normal' | 'player' | 'global';
export type SideSwapMode = 'moveTeams' | 'colorsOnly';

export type PlayerRole =
  | 'clash'
  | 'jungle'
  | 'mid'
  | 'farm'
  | 'roam';

export interface Team {
  id: string;
  name: string;
  logo: string;
  players: string[];
  playerRoles: PlayerRole[];
  playerPortraits: string[];
}

export interface ReservePlayer {
  id: string;
  name: string;
  role: PlayerRole;
  portrait: string;
}

export interface TeamPreset extends Team {
  substitutes: ReservePlayer[];
  createdAt: number;
  updatedAt: number;
}

export interface GameDraftRecord {
  firstPickSide: Side;
  heroPool?:HeroPool;
  banCount?:BanCount;
  id: string;
  gameNumber: number;
  committedAt: number;
  blueTeam: Team;
  redTeam: Team;
  bluePlayerSlotOrder?: number[];
  redPlayerSlotOrder?: number[];
  /** Immutable draft-order history. */
  blueBans?: Array<number | null>;
  redBans?: Array<number | null>;
  bluePicks: number[];
  redPicks: number[];
  /** Final hero ownership by player slot after help-picks / swaps. */
  blueAssignments: number[];
  redAssignments: number[];
}

export interface MatchState {
  liveGameStats: LiveGameStats;
  postGameReports: PostGameReport[];
  activePostGameReportId: string | null;
  blueTeam: Team;
  redTeam: Team;

  blueScore: number;
  redScore: number;

  gameNumber: number;
  seriesFormat: 'BO1' | 'BO3' | 'BO5';
  stage: string;

  language: Language;
  overlayLayout: OverlayLayout;
  scoreDisplay?: 'number' | 'boxes';
  bpInputMode?: 'manual' | 'screen';
  recognitionAutoAccept?: boolean;
  recognitionThreshold?: number;
  showHeroName: boolean;
  artSourceMode: 'auto' | 'legacy';
  heroArtOverrides: Record<string, HeroArtOverride>;
  heroDataOverrides: Record<string, HeroDataOverride>;

  draftMode: 'match' | 'normal';
  heroPool:HeroPool;
  banCount:BanCount;
  displayLeftSide: Side;
  firstPickSide: Side;
  sideSwapMode: SideSwapMode;
  draftRuleMode: DraftRuleMode;
  flowbornFormsIndependent: boolean;
  draftHistory: GameDraftRecord[];
  draftGameNumber: number | null;
  committedGameId: string | null;
  currentPhase: number;
  draftComplete: boolean;

  /** Ban slots preserve empty bans as null so phase order/history stay exact. */
  blueBans: Array<number | null>;
  redBans: Array<number | null>;
  /** Pick order is immutable draft history; assignments drive player cards. */
  bluePicks: number[];
  redPicks: number[];
  /** Screen P1–P5 -> roster index; never mutates Team or presets. */
  bluePlayerSlotOrder: number[];
  redPlayerSlotOrder: number[];
  blueAssignments: Array<number | null>;
  redAssignments: Array<number | null>;
}

export type MatchSettings = Pick<
  MatchState,
  | 'blueTeam'
  | 'redTeam'
  | 'blueScore'
  | 'redScore'
  | 'gameNumber'
  | 'seriesFormat'
  | 'stage'
  | 'draftMode'
  | 'heroPool'
  | 'banCount'
  | 'draftRuleMode'
  | 'flowbornFormsIndependent'
  | 'firstPickSide'
  | 'sideSwapMode'
  | 'language'
  | 'overlayLayout'
  | 'scoreDisplay'
  | 'bpInputMode'
  | 'recognitionAutoAccept'
  | 'recognitionThreshold'
  | 'showHeroName'
  | 'artSourceMode'
>;

export type Action =
  | { type: 'post_game_begin'; gameId?: string }
  | { type: 'post_game_fields'; reportId:string; updates:Array<{rowId:string;metric:PostGameMetric;field:PostGameField}>; grades?:Array<{rowId:string;field:PostGameGradeField}> }
  | { type: 'post_game_grades'; reportId:string; updates:Array<{rowId:string;field:PostGameGradeField}> }
  | { type: 'post_game_mvp_art_scale'; reportId:string; scale:number }
  | { type: 'post_game_team_fields'; reportId:string; updates:Array<{side:Side;metric:PostGameTeamMetric;field:PostGameField}>; goldDifference?:GoldDifferenceTimeline }
  | { type: 'select_mvp'; reportId:string; rowId:string|null }
  | { type: 'post_game_gold_timeline'; reportId:string; points:GoldTimelinePoint[] }
  | { type: 'live_game_stats'; stats: LiveGameStats }
  | { type: 'live_game_ocr'; context:string; previous:LiveHudSample; sample:LiveHudSample }
  | { type: 'live_game_freeze'; key:LiveCaptureKey; frozen:boolean }
  | { type: 'load_team_preset'; side: Side; presetId: string }
  | { type: 'draft_action'; team: Side; action: 'ban' | 'pick'; heroId: number }
  /** Explicit operator correction for an already locked slot. Historical games use gameId. */
  | { type: 'replace_draft_hero'; team: Side; action: 'ban' | 'pick'; index: number; heroId: number; gameId?: string }
  | { type: 'draft_pick_group'; team: Side; heroIds: number[] }
  | { type: 'skip_ban'; team: Side }
  | { type: 'undo' | 'reset_draft' | 'reset_match' }
  | { type: 'commit_game' | 'next_game' | 'swap_sides' }
  | { type: 'score'; team: Side; delta: 1 | -1 }
  | { type: 'swap_picks'; team: Side; from: number; to: number } // legacy alias: swaps assignments, never pick order
  | { type: 'swap_assignments'; team: Side; from: number; to: number }
  | { type: 'set_player_slot_order'; side: Side; order: number[]; expectedPlayers: string[] }
  | { type: 'set_player_slot_orders'; blue: number[]; red: number[]; expectedPlayers: [string[], string[]] }
  | { type: 'set_lineup_assignments'; blue: number[]; red: number[] }
  | { type: 'settings'; settings: MatchSettings }
  | { type: 'hero_art_override'; heroId: number; override: HeroArtOverride }
  | { type: 'reset_hero_art_override'; heroId: number; layout?: HeroArtLayout }
  | { type: 'hero_data_override'; heroId: number; override: HeroDataOverride }
  | { type: 'reset_hero_data_override'; heroId: number }
  | { type: 'delay'; seconds: number };

export type Role = 'control' | 'caster' | 'overlay';

export interface Snapshot {
  type: 'match_state_update';
  state: MatchState;
  revision: number;
  casterDelaySeconds?: number;
  canUndo?: boolean;
}

export const initialState = (): MatchState => ({
  liveGameStats: initialLiveGameStats(),
  postGameReports: [],
  activePostGameReportId: null,
  blueTeam: {
    id: 'team-a',
    name: '蓝方队伍',
    logo: '',
    players: ['', '', '', '', ''],
    playerRoles: ['clash', 'jungle', 'mid', 'farm', 'roam'],
    playerPortraits: ['', '', '', '', ''],
  },

  redTeam: {
    id: 'team-b',
    name: '红方队伍',
    logo: '',
    players: ['', '', '', '', ''],
    playerRoles: ['clash', 'jungle', 'mid', 'farm', 'roam'],
    playerPortraits: ['', '', '', '', ''],
  },

  blueScore: 0,
  redScore: 0,

  gameNumber: 1,
  seriesFormat: 'BO3',
  stage: '社区赛事',

  language: 'zh',
  overlayLayout: 'panel',
  scoreDisplay: 'number',
  bpInputMode: 'manual',
  recognitionAutoAccept: false,
  recognitionThreshold: 90,
  showHeroName: true,
  artSourceMode: 'auto',
  heroArtOverrides: {},
  heroDataOverrides: {},

  draftMode: 'match',
  heroPool:'global',
  banCount:4,
  displayLeftSide: 'blue',
  firstPickSide: 'blue',
  sideSwapMode: 'moveTeams',
  draftRuleMode: 'normal',
  flowbornFormsIndependent: true,
  draftHistory: [],
  draftGameNumber: null,
  committedGameId: null,
  currentPhase: 0,
  draftComplete: false,

  blueBans: [],
  redBans: [],
  bluePicks: [],
  redPicks: [],
  bluePlayerSlotOrder: [0, 1, 2, 3, 4],
  redPlayerSlotOrder: [0, 1, 2, 3, 4],
  blueAssignments: [null, null, null, null, null],
  redAssignments: [null, null, null, null, null],
});

/** Phase scheduling is independent from which server owns the hero roster.
 * Match order retains 2+2 (global) and 2+3 (2026 KPL) bans.
 * Normal mode keeps the original all-bans-first order.
 */
export function phases(mode:MatchState['draftMode'],firstPickSide:Side='blue',banCount:BanCount=defaultBansForMode(mode)){
  const first: string[]=[];
  const second: string[]=[];
  if(mode==='match'){
    for(let i=0;i<Math.min(2,banCount);i++)first.push('bb','rb');
    for(let i=0;i<Math.max(0,banCount-2);i++)second.push('rb','bb');
  } else {
    for(let i=0;i<banCount;i++)first.push('bb');
    for(let i=0;i<banCount;i++)first.push('rb');
  }
  const sequence=[...first,
    'bp','rp','rp','bp','bp','rp',
    ...(mode==='match'?second:[]),
    'rp','bp','bp','rp'].join(' ');
  return sequence.split(' ').map(s => ({
    team: ((s[0] === 'b') === (firstPickSide === 'blue') ? 'blue' : 'red') as Side,
    action: (s[1] === 'b' ? 'ban' : 'pick') as 'ban' | 'pick',
  }));
}
