import heroes from '../components/HeroList.js';
import { draftHeroUsed, draftRestriction } from '../shared/draftRules.js';
import { phases, type MatchState, type Side } from '../shared/types.js';
import { draftTurnAtPhase, previousDraftTurnStart } from '../shared/draftTurns.js';
import { migrateLegacyHeroId } from '../data/heroIdOrder.js';

export interface SimulatorPhaseSlot {
  side: Side;
  action: 'ban' | 'pick';
  slotIndex: number;
  phaseIndex: number;
}

export const simulatorAllSlotKeys = [
  'blueBan1','blueBan2','blueBan3','blueBan4',
  'redBan1','redBan2','redBan3','redBan4',
  'bluePick1','bluePick2','bluePick3','bluePick4','bluePick5',
  'redPick1','redPick2','redPick3','redPick4','redPick5',
] as const;


export function migrateLegacySimulatorSlotHeroes(slotHeroes:Record<string,number>|undefined) {
  return Object.fromEntries(
    Object.entries(slotHeroes??{}).map(([key,id])=>[key,migrateLegacyHeroId(Number(id)) as number]),
  ) as Record<string,number>;
}

export type SimulatorTestMode = 'bp' | 'lineup' | 'player-order';
export type SimulatorScene = 'lobby' | 'draft';
export type SimulatorPlayerProfile = 'mixed' | 'latin' | 'zh' | 'ja' | 'confusable';

const PLAYER_ID_POOLS: Record<SimulatorPlayerProfile,string[]> = {
  latin: [
    'EaDen-01','Nova.O','L1ght','Zero0','K1ng','Aster_7','Raven-X','Miko99','BlueJay','Frost.5',
    'Orbit_1','Echo-0','NexusV','Pixel8','Solaris',
  ],
  zh: [
    '逐风','北辰','星河','小满','阿杰','千夜','凌霄','沐风','青岚','长安',
    '云归','听雨','白榆','南星','知夏',
  ],
  ja: [
    'アキラ','ユウキ','レン','サクラ','ハル','ミナト','ソラ','カイト','ナオ','ヒカル',
    'リク','ユナ','レイ','シン','アオイ',
  ],
  confusable: [
    'Nova0','NovaO','L1ght','LIght','lIine','line1','B8ta','Beta','S5tar','Star5',
    'O0O','I1I','ZeroO','0cean','Ocean0',
  ],
  mixed: [
    'EaDen-01','Nova.O','L1ght','Zero0','K1ng',
    '逐风','北辰','星河','小满','青岚',
    'Aster_7','Raven-X','Pixel8','Orbit_1','Echo-0',
    '长安','听雨','白榆','南星','知夏',
  ],
};

function shuffled<T>(values:readonly T[],random:()=>number) {
  const output=[...values];
  for(let index=output.length-1;index>0;index--) {
    const target=Math.floor(Math.min(.999999,Math.max(0,random()))*(index+1));
    [output[index],output[target]]=[output[target],output[index]];
  }
  return output;
}

export function simulatorPlayerTestRoster(
  profile:SimulatorPlayerProfile,
  random:()=>number=Math.random,
) {
  const selected=shuffled(PLAYER_ID_POOLS[profile],random).slice(0,10);
  if(selected.length<10) throw new Error('Simulator player ID pool is too small');
  return {blue:selected.slice(0,5),red:selected.slice(5,10)};
}

/** Shuffle only inside one team. Force a non-identity order so a test run always exercises alignment. */
export function simulatorRandomPlayerOrder(random:()=>number=Math.random) {
  const order=shuffled([0,1,2,3,4],random);
  if(order.every((value,index)=>value===index)) [order[0],order[1]]=[order[1],order[0]];
  return order;
}

export function simulatorPlayerOrdersMatch(actual:readonly number[],expected:readonly number[]) {
  return actual.length===5&&expected.length===5&&actual.every((value,index)=>value===expected[index]);
}

export function simulatorSlotForPhase(
  mode: MatchState['draftMode'],
  firstPickSide: Side,
  phaseIndex: number,
): SimulatorPhaseSlot | undefined {
  const sequence=phases(mode,firstPickSide);
  const phase=sequence[phaseIndex];
  if(!phase) return undefined;
  const slotIndex=sequence
    .slice(0,phaseIndex)
    .filter(item=>item.team===phase.team&&item.action===phase.action)
    .length;
  return {side:phase.team,action:phase.action,slotIndex,phaseIndex};
}


export function simulatorSlotsForTurn(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
) {
  const turn=draftTurnAtPhase(mode,firstPickSide,phaseIndex);
  if(!turn) return [];
  return turn.phaseIndexes
    .map(index=>simulatorSlotForPhase(mode,firstPickSide,index))
    .filter((slot):slot is SimulatorPhaseSlot=>!!slot);
}

export function simulatorNextTurnPhase(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
) {
  return draftTurnAtPhase(mode,firstPickSide,phaseIndex)?.endPhaseExclusive ?? phases(mode,firstPickSide).length;
}

export function simulatorPreviousTurnPhase(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
) {
  return previousDraftTurnStart(mode,firstPickSide,phaseIndex);
}

export function simulatorSlotKey(slot:SimulatorPhaseSlot) {
  return `${slot.side}${slot.action==='ban'?'Ban':'Pick'}${slot.slotIndex+1}`;
}

/**
 * Physical left-to-right order on the screen.
 * Blue fills B1 -> B4 from left to right. Red is axis-mirrored, so B1 is
 * physically the right-most circle and the visible order is B4 -> B1.
 */
export function simulatorBanVisualKeys(side:Side) {
  const keys=Array.from({length:4},(_,index)=>`${side}Ban${index+1}`);
  return side==='blue'?keys:keys.reverse();
}

export function simulatorRandomDelayMs(
  minMs:number,
  maxMs:number,
  random:()=>number=Math.random,
) {
  const min=Math.max(0,Math.min(minMs,maxMs));
  const max=Math.max(min,Math.max(minMs,maxMs));
  if(max===min) return Math.round(min);
  return Math.round(min+(max-min)*Math.min(1,Math.max(0,random())));
}

/**
 * Random preselect changes during the player's thinking window. The last
 * switch always leaves a quiet window before lock so Control can accumulate
 * stable hero evidence even in a 3–6 second stress test.
 */
export function simulatorPreselectSwitchMoments(
  totalMs:number,
  random:()=>number=Math.random,
  quietBeforeLockMs=1200,
) {
  const end=Math.max(0,totalMs-Math.max(700,quietBeforeLockMs));
  const moments:number[]=[];
  let cursor=400+Math.floor(Math.min(1,Math.max(0,random()))*400);
  while(cursor<end&&moments.length<6) {
    moments.push(cursor);
    cursor+=450+Math.floor(Math.min(1,Math.max(0,random()))*450);
  }
  return moments;
}

export function swapSimulatorPickHeroes(
  assignments:Record<string,number>,
  side:Side,
  firstIndex:number,
  secondIndex:number,
) {
  if(firstIndex===secondIndex) return {...assignments};
  const firstKey=`${side}Pick${firstIndex+1}`;
  const secondKey=`${side}Pick${secondIndex+1}`;
  return {
    ...assignments,
    [firstKey]:assignments[secondKey],
    [secondKey]:assignments[firstKey],
  };
}


export interface SimulatorControlSync {
  mode: MatchState['draftMode'];
  firstPickSide: Side;
  phaseIndex: number;
  slotHeroes: Record<string,number>;
  emptyBans: string[];
  locked: string[];
  bluePlayers: string[];
  redPlayers: string[];
  bluePlayerOrder: number[];
  redPlayerOrder: number[];
  lineupBlue: number[];
  lineupRed: number[];
}

/**
 * Convert authoritative Control state into Simulator screen state.
 *
 * BP mode copies immutable Ban/Pick history. Lineup mode asks for
 * useFinalAssignments=true so P1-P5 show the current post-swap ownership
 * instead of the original pick order.
 */
export function simulatorControlSync(
  state: MatchState,
  currentSlots: Record<string,number> = {},
  useFinalAssignments = false,
): SimulatorControlSync {
  const slotHeroes={...currentSlots};
  const emptyBans:string[]=[];
  const locked:string[]=[];
  const sequence=phases(state.draftMode,state.firstPickSide);
  const finalFor=(side:Side)=>{
    const assignments=state[`${side}Assignments`] as Array<number|null>;
    const picks=state[`${side}Picks`] as number[];
    return assignments.length===5&&assignments.every((hero):hero is number=>Number.isInteger(hero))
      ? [...assignments] : [...picks];
  };
  const lineupBlue=finalFor('blue');
  const lineupRed=finalFor('red');

  sequence.forEach((phase,index)=>{
    const slot=simulatorSlotForPhase(state.draftMode,state.firstPickSide,index);
    if(!slot) return;
    const key=simulatorSlotKey(slot);
    if(phase.action==='ban'){
      const bans=state[`${phase.team}Bans`] as Array<number|null>;
      const heroId=bans[slot.slotIndex];
      if(heroId===null) emptyBans.push(key);
      else if(Number.isInteger(heroId)) slotHeroes[key]=heroId as number;
    }else{
      const source=useFinalAssignments&&state.draftComplete
        ? (phase.team==='blue'?lineupBlue:lineupRed)
        : state[`${phase.team}Picks`] as number[];
      const heroId=source[slot.slotIndex];
      if(Number.isInteger(heroId)) slotHeroes[key]=heroId;
    }
    if(index<state.currentPhase||state.draftComplete) locked.push(key);
  });

  return {
    mode:state.draftMode,
    firstPickSide:state.firstPickSide,
    phaseIndex:Math.min(state.currentPhase,sequence.length),
    slotHeroes,
    emptyBans,
    locked,
    bluePlayers:[...state.blueTeam.players],
    redPlayers:[...state.redTeam.players],
    bluePlayerOrder:[...state.bluePlayerSlotOrder],
    redPlayerOrder:[...state.redPlayerSlotOrder],
    lineupBlue,
    lineupRed,
  };
}

export function completedSimulatorSlots(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
) {
  return phases(mode,firstPickSide)
    .slice(0,Math.max(0,phaseIndex))
    .map((_,index)=>simulatorSlotForPhase(mode,firstPickSide,index)!)
    .filter(Boolean);
}

/** Walk draft order, using the same restrictions as Control. Future slots do not consume heroes. */
export function randomizeSimulatorSlots(
  assignments:Record<string,number>,
  mode:MatchState['draftMode'], firstPickSide:Side,
  rules:MatchState, keys:ReadonlySet<string>, emptyBans:readonly string[]=[],
  random:()=>number=Math.random,
) {
  const draft:MatchState={...rules,blueBans:[],redBans:[],bluePicks:[],redPicks:[],currentPhase:0};
  const output={...assignments};
  for(let index=0;index<phases(mode,firstPickSide).length;index++) {
    const slot=simulatorSlotForPhase(mode,firstPickSide,index)!;
    const key=simulatorSlotKey(slot);
    if(emptyBans.includes(key)&&slot.action==='ban') { draft[`${slot.side}Bans`].push(null); continue; }
    if(keys.has(key)) {
      const pool=heroes.filter(hero=>!draftHeroUsed(draft,hero.id)&&!draftRestriction(draft,slot.side,slot.action,hero.id));
      if(!pool.length) throw new Error(`No legal hero for ${key}; check player IDs and BP history`);
      output[key]=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))].id;
    }
    // Only earlier selections matter when randomizing the current turn.
    const id=output[key];
    if(id!==undefined) draft[`${slot.side}${slot.action==='ban'?'Bans':'Picks'}`].push(id);
    draft.currentPhase++;
  }
  return output;
}
