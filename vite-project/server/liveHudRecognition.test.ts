import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { liveGameContext, trustedLiveUpdates, liveHudReviewStates, displayedGameSeconds, totalNeutralObjectives, initialLiveGameStats, type LiveHudSample } from '../src/shared/liveGame.js';
import { liveCaptureKeys, liveCaptureRects, liveCaptureProfile, validLiveCaptureRects, parseLiveNumber } from '../src/shared/gameCapture.js';
import type { Action } from '../src/shared/types.js';

const apply=(s:Store,action:Action)=>s.apply(randomUUID(),s.data.revision,action);
const sample=(at:number,time:number,gold=1500,kills=0):LiveHudSample=>({capturedAt:at,candidates:liveCaptureKeys.map(key=>({key,value:key==='gameTimeSeconds'?time:key.endsWith('Gold')?gold:key.endsWith('Kills')?kills:0,confidence:.96,text:''}))});
test('GHUD samples require coherent time, two reads, plausible trends and the current game',()=>{
  let now=100000;const s=new Store(undefined,()=>now),context=liveGameContext(s.data.state);
  const previous=sample(now-5000,10),current=sample(now,15);
  apply(s,{type:'live_game_ocr',context,previous,sample:current});
  assert.equal(s.data.state.liveGameStats.blueGold,1500);assert.equal(s.data.state.liveGameStats.gameTimeSeconds,15);
  now+=5000;
  const jump=sample(now,20,87000),jumpPrior=sample(now-5000,15,87000);
  apply(s,{type:'live_game_ocr',context,previous:jumpPrior,sample:jump});
  assert.equal(s.data.state.liveGameStats.blueGold,1500,'two matching but implausible OCR readings cannot jump economy');
  assert.equal(s.data.state.liveGameStats.gameTimeSeconds,20);
  const revision=s.data.revision;
  assert.throws(()=>apply(s,{type:'live_game_ocr',context:'another game',previous:current,sample:jump}),/Game changed/);
  assert.throws(()=>apply(s,{type:'live_game_ocr',context,previous:current,sample:sample(now-40000,20)}),/expired/);
  const noTime=sample(now,20);noTime.candidates.find(c=>c.key==='gameTimeSeconds')!.value=null;
  assert.throws(()=>apply(s,{type:'live_game_ocr',context,previous:current,sample:noTime}),/No consistent/);
  const bad=sample(now,20);bad.candidates[0].confidence=NaN;
  assert.throws(()=>apply(s,{type:'live_game_ocr',context,previous:current,sample:bad}),/Invalid HUD/);
  assert.equal(s.data.revision,revision);
});
test('manual HUD values freeze, resume is explicit, undo works and polls retain delayed data without unbounded history',()=>{
  let now=100000;const s=new Store(undefined,()=>now),context=liveGameContext(s.data.state);
  apply(s,{type:'live_game_stats',stats:{...s.data.state.liveGameStats,blueKills:7}});
  assert.equal(s.data.state.liveGameStats.sources?.blueKills?.source,'manual');
  apply(s,{type:'live_game_ocr',context,previous:sample(now-5000,10,1500,8),sample:sample(now,15,1500,8)});
  assert.equal(s.data.state.liveGameStats.blueKills,7);assert.equal(s.data.state.liveGameStats.redKills,8);
  apply(s,{type:'live_game_freeze',key:'blueKills',frozen:false});
  now+=5000;apply(s,{type:'live_game_ocr',context,previous:sample(now-5000,15,1500,8),sample:sample(now,20,1500,8)});
  assert.equal(s.data.state.liveGameStats.blueKills,8);
  apply(s,{type:'undo'});assert.equal(s.data.state.liveGameStats.blueKills,7);
  for(let i=0;i<230;i++){
    now+=5000;
    apply(s,{type:'live_game_ocr',context,previous:sample(now-5000,20+i*5,1500,8),sample:sample(now,25+i*5,1500,8)});
  }
  assert.ok(s.data.history.length<=200);
  assert.ok(s.snapshot('caster').state.liveGameStats.gameTimeSeconds!<s.data.state.liveGameStats.gameTimeSeconds!);
  // Keep the full supported Caster delay window, then prune old automatic polls.
  now+=3600000;
  for(const key of liveCaptureKeys)apply(s,{type:'live_game_freeze',key,frozen:false});
  apply(s,{type:'live_game_ocr',context,previous:sample(now-5000,5000,1500,8),sample:sample(now,5005,1500,8)});
  assert.ok(s.data.events.filter(e=>e.type==='live_game_ocr').length<=2);
  apply(s,{type:'reset_match'});assert.equal(s.data.state.liveGameStats.gameTimeSeconds,undefined);assert.equal(s.data.state.liveGameStats.sources,undefined);
});
test('HUD parser rejects overflow and ambiguous counters',()=>{
  assert.equal(parseLiveNumber('37.3k','blueGold'),37300);assert.equal(parseLiveNumber('11:59','gameTimeSeconds'),719);
  for(const [text,key] of [['11:60','gameTimeSeconds'],['200:00','gameTimeSeconds'],['12','blueTowers'],['O','blueKills'],['1.5','blueKills']] as const)assert.equal(parseLiveNumber(text,key),null);
});

test('clearing optional HUD values keeps them unknown until explicitly resumed and supports undo',()=>{
  for(const key of ['blueGold','redGold','gameTimeSeconds'] as const){
    let now=100000;const s=new Store(undefined,()=>now),context=liveGameContext(s.data.state);
    apply(s,{type:'live_game_ocr',context,previous:sample(now-5000,10),sample:sample(now,15)});
    const original=s.data.state.liveGameStats[key];
    const clear=()=>apply(s,{type:'live_game_stats',stats:{...s.data.state.liveGameStats,[key]:undefined}});
    clear();assert.equal(s.data.state.liveGameStats[key],undefined);
    assert.equal(s.data.state.liveGameStats.sources?.[key]?.source,'manual');
    apply(s,{type:'undo'});assert.equal(s.data.state.liveGameStats[key],original);
    assert.equal(s.data.state.liveGameStats.sources?.[key]?.source,'ocr');
    clear();now+=5000;
    apply(s,{type:'live_game_ocr',context,previous:sample(now-5000,15),sample:sample(now,20)});
    assert.equal(s.data.state.liveGameStats[key],undefined,'automatic capture must preserve a manual unknown value');
    apply(s,{type:'live_game_freeze',key,frozen:false});now+=5000;
    apply(s,{type:'live_game_ocr',context,previous:sample(now-5000,20),sample:sample(now,25)});
    assert.equal(s.data.state.liveGameStats[key],key==='gameTimeSeconds'?25:1500);
    assert.equal(s.data.state.liveGameStats.sources?.[key]?.source,'ocr');
  }
});

test('GHUD requires a complete geometrically valid ROI profile, two reads from same profile',()=>{
  assert.equal(validLiveCaptureRects(liveCaptureRects),true);
  const shift=structuredClone(liveCaptureRects);
  shift.redGold={...shift.blueGold};
  assert.equal(validLiveCaptureRects(shift),false,'two overlapping scoreboard crops must not be treated as separate fields');
  const incomplete={...liveCaptureRects} as Record<string,unknown>;
  delete incomplete.blueGold;
  assert.equal(validLiveCaptureRects(incomplete),false);
  const malformed={...liveCaptureRects,blueKills:{x:0,y:0,width:2,height:.1}};
  assert.equal(validLiveCaptureRects(malformed),false);
  const a=sample(100000,12),b=sample(105000,17);
  a.profile=liveCaptureProfile(liveCaptureRects);
  b.profile=liveCaptureProfile(shift);
  const store=new Store(undefined,()=>105000);
  const context=liveGameContext(store.data.state);
  assert.throws(()=>apply(store,{type:'live_game_ocr',context,previous:a,sample:b}),/No consistent/);
  b.profile=a.profile;
  assert.ok(a.profile.length>10);
});


test('GHUD UI distinguishes first read, low confidence, stalled clock and already published OCR', () => {
  const baseline = initialLiveGameStats();
  const first = sample(100000, 130, 6200, 8);
  const second = sample(101000, 131, 6300, 8);
  first.profile = 'same HUD calibration';
  second.profile = first.profile;
  assert.equal(liveHudReviewStates(baseline, undefined, first).blueKills, 'first-read');
  assert.equal(liveHudReviewStates(baseline, first, second).blueKills, 'verified');
  assert.equal(liveHudReviewStates(baseline, first, second).gameTimeSeconds, 'verified');

  const applied = {
    ...baseline,
    blueKills: 8,
    gameTimeSeconds: 131,
    sources: {
      blueKills: { source: 'ocr' as const, capturedAt: second.capturedAt, confidence: .96 },
      gameTimeSeconds: { source: 'ocr' as const, capturedAt: second.capturedAt, confidence: .96 },
    },
  };
  // The same frame is no longer eligible for another write, but it is already trusted.
  assert.equal(trustedLiveUpdates(applied, first, second).blueKills, undefined);
  assert.equal(trustedLiveUpdates(applied, first, second).gameTimeSeconds, undefined);
  assert.equal(liveHudReviewStates(applied, first, second).blueKills, 'published');
  assert.equal(liveHudReviewStates(applied, first, second).gameTimeSeconds, 'published');

  const weak = structuredClone(second);
  weak.candidates.find(candidate => candidate.key === 'redKills')!.confidence = .77;
  assert.equal(liveHudReviewStates(baseline, first, weak).redKills, 'low-confidence');
  const frozen = {...baseline,sources:{blueKills:{source:'manual' as const,capturedAt:90000,confidence:1}}};
  assert.equal(liveHudReviewStates(frozen, first, second).blueKills, 'manual');

  const still = structuredClone(second);
  still.candidates.find(candidate => candidate.key === 'gameTimeSeconds')!.value = 130;
  assert.equal(liveHudReviewStates(baseline, first, still).blueGold, 'clock-stalled');
  assert.equal(liveHudReviewStates(baseline, first, still).gameTimeSeconds, 'clock-stalled');
  assert.deepEqual(trustedLiveUpdates(baseline, first, still), {});
});

test('unchanged OCR game clock cannot verify a frozen replay frame',()=>{
  const stats=new Store().data.state.liveGameStats;
  const a=sample(100000,30);const b=sample(105000,30);
  assert.equal(Object.keys(trustedLiveUpdates(stats,a,b)).length,0);
});

test('GHUD seconds follow recent OCR clock at 1-second resolution, not stale or manual data',()=>{
  const stats=initialLiveGameStats();
  stats.gameTimeSeconds=371;
  stats.sources={gameTimeSeconds:{source:'ocr',capturedAt:100000,confidence:.97}};
  assert.equal(displayedGameSeconds(stats,100000),371);
  assert.equal(displayedGameSeconds(stats,101200),372);
  assert.equal(displayedGameSeconds(stats,102100),373);
  assert.equal(displayedGameSeconds(stats,116000),371,'stale OCR must not extrapolate indefinitely');
  stats.sources.gameTimeSeconds={source:'manual',capturedAt:100000,confidence:1};
  assert.equal(displayedGameSeconds(stats,102100),371,'manual clock cannot pretend to be synchronized');
  stats.gameTimeSeconds=undefined;
  assert.equal(displayedGameSeconds(stats,102100),undefined);
});
test('HUD custom height and neutral boss presence persist, reset between games and reject invalid status',()=>{
  const s=new Store();
  const stats={...s.data.state.liveGameStats,heightPx:184,neutralObjectives:[
    {id:'tyrant',name:'Tyrant',icon:'',blue:2,red:1,status:'alive' as const},
    {id:'overlord',name:'Overlord',icon:'',blue:0,red:1,status:'down' as const},
  ]};
  apply(s,{type:'live_game_stats',stats});
  assert.equal(s.data.state.liveGameStats.heightPx,184);
  assert.equal(totalNeutralObjectives(s.data.state.liveGameStats,'blue'),2);
  assert.equal(totalNeutralObjectives(s.data.state.liveGameStats,'red'),2);
  assert.equal(s.data.state.liveGameStats.neutralObjectives[0].status,'alive');
  assert.throws(()=>apply(s,{type:'live_game_stats',stats:{...stats,heightPx:250}}),/64/);
  assert.throws(()=>apply(s,{type:'live_game_stats',stats:{...stats,neutralObjectives:[{...stats.neutralObjectives[0],status:'invalid' as 'alive'}]}}),/Invalid objective status/);
});
