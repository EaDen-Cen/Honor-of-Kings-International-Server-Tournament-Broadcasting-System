import { useCallback, useEffect, useState } from 'react';
import heroes from '../components/HeroList.js';
import type { MatchState, Side } from '../shared/types.js';
import { migrateLegacySimulatorSlotHeroes, simulatorAllSlotKeys, type SimulatorPlayerProfile, type SimulatorScene, type SimulatorTestMode } from './bpSimulatorModel.js';

export type SimulatorSlotMap = Record<string,number>;

export interface BpSimulatorState {
  mode: MatchState['draftMode'];
  firstPickSide: Side;
  phaseIndex: number;
  slotHeroes: SimulatorSlotMap;
  emptyBans: string[];
  locked: string[];
  autoPlay: boolean;
  intervalMinMs: number;
  intervalMaxMs: number;
  transitionHoldMs: number;
  preselectSwitching: boolean;
  banSize: number;
  pickSize: number;
  testMode: SimulatorTestMode;
  scene: SimulatorScene;
  playerProfile: SimulatorPlayerProfile;
  bluePlayers: string[];
  redPlayers: string[];
  bluePlayerOrder: number[];
  redPlayerOrder: number[];
  playerRosterPrepared: boolean;
  playerOrderTestStartedAt: number | null;
  playerOrderTestCompletedAt: number | null;
}

const STORAGE_KEY='hok-bp-simulator-state-v3';
const LEGACY_STORAGE_KEY='hok-bp-simulator-state-v2';

function defaultAssignments():SimulatorSlotMap {
  const ids=heroes.slice(0,simulatorAllSlotKeys.length).map(hero=>hero.id);
  return Object.fromEntries(simulatorAllSlotKeys.map((key,index)=>[
    key,
    ids[index%Math.max(ids.length,1)] ?? heroes[0]?.id ?? 0,
  ]));
}

export function createDefaultBpSimulatorState():BpSimulatorState {
  return {
    mode:'match',
    firstPickSide:'blue',
    phaseIndex:0,
    slotHeroes:defaultAssignments(),
    emptyBans:[],
    locked:[],
    autoPlay:false,
    intervalMinMs:900,
    intervalMaxMs:1800,
    transitionHoldMs:1100,
    preselectSwitching:true,
    banSize:38,
    pickSize:72,
    testMode:'bp',
    scene:'draft',
    playerProfile:'mixed',
    bluePlayers:['BLUE.P1','BLUE.P2','BLUE.P3','BLUE.P4','BLUE.P5'],
    redPlayers:['RED.P1','RED.P2','RED.P3','RED.P4','RED.P5'],
    bluePlayerOrder:[0,1,2,3,4],
    redPlayerOrder:[0,1,2,3,4],
    playerRosterPrepared:false,
    playerOrderTestStartedAt:null,
    playerOrderTestCompletedAt:null,
  };
}

function clamp(value:number,min:number,max:number) {
  return Math.max(min,Math.min(max,value));
}


function normalizeState(value:Partial<BpSimulatorState>|undefined,migrateLegacyIds=false):BpSimulatorState {
  const defaults=createDefaultBpSimulatorState();
  const source=value??{};
  const incoming={...(source.slotHeroes??{})};
  const migratedIncoming=migrateLegacyIds
    ? migrateLegacySimulatorSlotHeroes(incoming)
    : incoming;
  const slotHeroes={...defaults.slotHeroes,...migratedIncoming};
  const rawMin=clamp(Number(source.intervalMinMs)||Number((source as {intervalMs?:number}).intervalMs)||defaults.intervalMinMs,300,15000);
  const rawMax=clamp(Number(source.intervalMaxMs)||Number((source as {intervalMs?:number}).intervalMs)||defaults.intervalMaxMs,300,15000);
  const intervalMinMs=Math.min(rawMin,rawMax);
  const intervalMaxMs=Math.max(rawMin,rawMax);
  const normalizePlayers=(value:unknown,fallback:string[])=>Array.isArray(value)&&value.length===5&&value.every(item=>typeof item==='string')
    ? value.map(item=>String(item).slice(0,40)) : fallback;
  const normalizeOrder=(value:unknown)=>Array.isArray(value)&&value.length===5&&new Set(value).size===5&&value.every(item=>Number.isInteger(item)&&Number(item)>=0&&Number(item)<5)
    ? value.map(Number) : [0,1,2,3,4];
  const testMode:SimulatorTestMode=source.testMode==='lineup'||source.testMode==='player-order'?source.testMode:'bp';
  const scene:SimulatorScene=source.scene==='lobby'?'lobby':'draft';
  const playerProfile:SimulatorPlayerProfile=['mixed','latin','zh','ja','confusable'].includes(String(source.playerProfile))
    ? source.playerProfile as SimulatorPlayerProfile : 'mixed';
  return {
    mode:source.mode==='normal'?'normal':'match',
    firstPickSide:source.firstPickSide==='red'?'red':'blue',
    phaseIndex:Number.isFinite(source.phaseIndex)?Math.max(0,Math.floor(source.phaseIndex!)):0,
    slotHeroes,
    emptyBans:Array.isArray(source.emptyBans)?source.emptyBans.filter(key=>typeof key==='string'):[],
    locked:Array.isArray(source.locked)?source.locked.filter(key=>typeof key==='string'):[],
    autoPlay:source.autoPlay===true,
    intervalMinMs,
    intervalMaxMs,
    transitionHoldMs:clamp(Number(source.transitionHoldMs)||defaults.transitionHoldMs,500,2500),
    preselectSwitching:source.preselectSwitching!==false,
    banSize:clamp(Number(source.banSize)||defaults.banSize,24,64),
    pickSize:clamp(Number(source.pickSize)||defaults.pickSize,48,104),
    testMode,
    scene,
    playerProfile,
    bluePlayers:normalizePlayers(source.bluePlayers,defaults.bluePlayers),
    redPlayers:normalizePlayers(source.redPlayers,defaults.redPlayers),
    bluePlayerOrder:normalizeOrder(source.bluePlayerOrder),
    redPlayerOrder:normalizeOrder(source.redPlayerOrder),
    playerRosterPrepared:source.playerRosterPrepared===true,
    playerOrderTestStartedAt:Number.isFinite(source.playerOrderTestStartedAt)?Number(source.playerOrderTestStartedAt):null,
    playerOrderTestCompletedAt:Number.isFinite(source.playerOrderTestCompletedAt)?Number(source.playerOrderTestCompletedAt):null,
  };
}

function readState() {
  if(typeof window==='undefined') return createDefaultBpSimulatorState();
  try {
    const current=localStorage.getItem(STORAGE_KEY);
    if(current) return normalizeState(JSON.parse(current)??undefined);

    const legacy=localStorage.getItem(LEGACY_STORAGE_KEY);
    if(legacy){
      const migrated=normalizeState(JSON.parse(legacy)??undefined,true);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));
      return migrated;
    }
    return createDefaultBpSimulatorState();
  } catch {
    return createDefaultBpSimulatorState();
  }
}

export function useBpSimulatorState() {
  const [state,setState]=useState<BpSimulatorState>(readState);

  const update=useCallback((updater:BpSimulatorState|((current:BpSimulatorState)=>BpSimulatorState))=>{
    setState(current=>{
      const next=normalizeState(typeof updater==='function'?updater(current):updater);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
      return next;
    });
  },[]);

  useEffect(()=>{
    const listener=(event:StorageEvent)=>{
      if(event.key!==STORAGE_KEY||!event.newValue) return;
      try { setState(normalizeState(JSON.parse(event.newValue))); } catch { /* ignore malformed external state */ }
    };
    window.addEventListener('storage',listener);
    return()=>window.removeEventListener('storage',listener);
  },[]);

  return [state,update] as const;
}
