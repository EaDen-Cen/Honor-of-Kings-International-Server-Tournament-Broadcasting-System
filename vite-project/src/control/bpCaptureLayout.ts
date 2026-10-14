import { phases, type MatchState, type Side } from '../shared/types.js';
import { defaultBansForMode } from '../shared/heroPool.js';
import { draftTurnAtPhase, nextDraftTurn, nextOpponentPickTurn } from '../shared/draftTurns.js';
import { normalizeCaptureRegion, type NormalizedCaptureRegion } from './windowCaptureGeometry.js';

export type CaptureSlotKey =
  | 'blueBan1' | 'blueBan2' | 'blueBan3' | 'blueBan4' | 'blueBan5'
  | 'redBan1' | 'redBan2' | 'redBan3' | 'redBan4' | 'redBan5'
  | 'bluePick1' | 'bluePick2' | 'bluePick3' | 'bluePick4' | 'bluePick5'
  | 'redPick1' | 'redPick2' | 'redPick3' | 'redPick4' | 'redPick5';

export type CaptureSlots = Record<CaptureSlotKey, NormalizedCaptureRegion> & { playerIds?: Record<string, NormalizedCaptureRegion> };

export interface LegacyCaptureZones {
  bluePick: NormalizedCaptureRegion;
  redPick: NormalizedCaptureRegion;
  blueBan: NormalizedCaptureRegion;
  redBan: NormalizedCaptureRegion;
}

export interface CaptureTarget {
  key: CaptureSlotKey;
  side: Side;
  action: 'ban' | 'pick';
  slotIndex: number;
  slotCount: number;
  region: NormalizedCaptureRegion;
}

export const captureSlotKeys: CaptureSlotKey[] = [
  'blueBan1','blueBan2','blueBan3','blueBan4','blueBan5',
  'redBan1','redBan2','redBan3','redBan4','redBan5',
  'bluePick1','bluePick2','bluePick3','bluePick4','bluePick5',
  'redPick1','redPick2','redPick3','redPick4','redPick5',
];

export const defaultLegacyZones: LegacyCaptureZones = {
  bluePick: { x:.035, y:.18, width:.105, height:.68 },
  redPick: { x:.86, y:.18, width:.105, height:.68 },
  blueBan: { x:.035, y:.035, width:.28, height:.11 },
  redBan: { x:.685, y:.035, width:.28, height:.11 },
};

function inset(region:NormalizedCaptureRegion, ratio=.07):NormalizedCaptureRegion {
  const xPad=region.width*ratio;
  const yPad=region.height*ratio;
  return normalizeCaptureRegion({
    x:region.x+xPad,
    y:region.y+yPad,
    width:Math.max(.02,region.width-xPad*2),
    height:Math.max(.02,region.height-yPad*2),
  });
}

function splitLegacyZone(
  zone:NormalizedCaptureRegion,
  action:'ban'|'pick',
  slotIndex:number,
  slotCount:number,
):NormalizedCaptureRegion {
  if(action==='pick') {
    return inset({
      x:zone.x,
      y:zone.y+zone.height*(slotIndex/slotCount),
      width:zone.width,
      height:zone.height/slotCount,
    },.08);
  }
  return inset({
    x:zone.x+zone.width*(slotIndex/slotCount),
    y:zone.y,
    width:zone.width/slotCount,
    height:zone.height,
  },.08);
}

/**
 * One-time migration/default helper only.
 * Runtime recognition never derives a slot from a row/column: every returned
 * rectangle is copied into an independent key and can be calibrated separately.
 */
export function slotsFromLegacyZones(zones:LegacyCaptureZones):CaptureSlots {
  const result={} as CaptureSlots;
  for(const side of ['blue','red'] as const) {
    for(let i=0;i<4;i++) {
      result[`${side}Ban${i+1}` as CaptureSlotKey]=splitLegacyZone(zones[`${side}Ban`], 'ban', i, 4);
    }
    // Preserve four proven ROIs; Ban #5 needs calibration for the new screen layout.
    result[`${side}Ban5` as CaptureSlotKey]=splitLegacyZone(zones[`${side}Ban`],'ban',4,5);
    for(let i=0;i<5;i++) {
      result[`${side}Pick${i+1}` as CaptureSlotKey]=splitLegacyZone(zones[`${side}Pick`], 'pick', i, 5);
    }
  }
  return result;
}

export const defaultCaptureSlots:CaptureSlots=slotsFromLegacyZones(defaultLegacyZones);

export function normalizeCaptureSlots(value:Partial<CaptureSlots>|undefined):CaptureSlots {
  const result = Object.fromEntries(captureSlotKeys.map(key=>[
    key,
    normalizeCaptureRegion(value?.[key] ?? defaultCaptureSlots[key]),
  ])) as unknown as CaptureSlots;
  if (value?.playerIds) result.playerIds = Object.fromEntries(Object.entries(value.playerIds).filter(([key])=>/^(blue|red)[1-5]$/.test(key)).map(([key,region])=>[key,normalizeCaptureRegion(region)]));
  return result;
}

export function slotMeta(key:CaptureSlotKey) {
  const match=/^(blue|red)(Ban|Pick)([1-5])$/.exec(key);
  if(!match) throw new Error(`Invalid capture slot: ${key}`);
  return {
    side:match[1] as Side,
    action:match[2].toLowerCase() as 'ban'|'pick',
    index:Number(match[3])-1,
  };
}

function previousSlotIndexAtPhase(
  state:Pick<MatchState,'draftMode'|'firstPickSide'>&{banCount?:MatchState['banCount']},
  phaseIndex:number,
  side:Side,
  action:'ban'|'pick',
) {
  return phases(state.draftMode,state.firstPickSide,(state.banCount??defaultBansForMode(state.draftMode)))
    .slice(0,phaseIndex)
    .filter(phase=>phase.team===side&&phase.action===action)
    .length;
}

export function slotCountFor(state:Pick<MatchState,'draftMode'>&{banCount?:MatchState['banCount']}, action:'ban'|'pick') {
  return action==='pick' ? 5 : (state.banCount??defaultBansForMode(state.draftMode));
}

export function captureTargetForPhaseIndex(
  state:Pick<MatchState,'draftMode'|'firstPickSide'>&{banCount?:MatchState['banCount']},
  slots:CaptureSlots,
  phaseIndex:number,
):CaptureTarget|undefined {
  const phase=phases(state.draftMode,state.firstPickSide,(state.banCount??defaultBansForMode(state.draftMode)))[phaseIndex];
  if(!phase) return undefined;
  const slotIndex=previousSlotIndexAtPhase(state,phaseIndex,phase.team,phase.action);
  const slotCount=slotCountFor(state,phase.action);
  const key=`${phase.team}${phase.action==='ban'?'Ban':'Pick'}${slotIndex+1}` as CaptureSlotKey;
  return {
    key,
    side:phase.team,
    action:phase.action,
    slotIndex,
    slotCount,
    region:slots[key],
  };
}

export function captureTargetForState(
  state:Pick<MatchState,'draftMode'|'firstPickSide'|'currentPhase'>&{banCount?:MatchState['banCount']},
  slots:CaptureSlots,
):CaptureTarget|undefined {
  return captureTargetForPhaseIndex(state,slots,state.currentPhase);
}

export function captureTargetsForCurrentTurn(
  state:Pick<MatchState,'draftMode'|'firstPickSide'|'currentPhase'>&{banCount?:MatchState['banCount']},
  slots:CaptureSlots,
):CaptureTarget[] {
  const turn=draftTurnAtPhase(state.draftMode,state.firstPickSide,state.currentPhase,(state.banCount??defaultBansForMode(state.draftMode)));
  if(!turn) return [];
  return turn.phaseIndexes
    .map(phaseIndex=>captureTargetForPhaseIndex(state,slots,phaseIndex))
    .filter((target):target is CaptureTarget=>!!target);
}

export function captureProbeForNextTurn(
  state:Pick<MatchState,'draftMode'|'firstPickSide'|'currentPhase'>&{banCount?:MatchState['banCount']},
  slots:CaptureSlots,
):CaptureTarget|undefined {
  const turn=nextDraftTurn(state.draftMode,state.firstPickSide,state.currentPhase,(state.banCount??defaultBansForMode(state.draftMode)));
  return turn ? captureTargetForPhaseIndex(state,slots,turn.startPhase) : undefined;
}


export function captureProbeForNextOpponentPick(
  state:Pick<MatchState,'draftMode'|'firstPickSide'|'currentPhase'>&{banCount?:MatchState['banCount']},
  slots:CaptureSlots,
):CaptureTarget|undefined {
  const turn=nextOpponentPickTurn(state.draftMode,state.firstPickSide,state.currentPhase,(state.banCount??defaultBansForMode(state.draftMode)));
  return turn ? captureTargetForPhaseIndex(state,slots,turn.startPhase) : undefined;
}
