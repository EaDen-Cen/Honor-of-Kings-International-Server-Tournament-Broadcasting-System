import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { liveGameContext, trustedLiveUpdates, type LiveHudSample } from '../src/shared/liveGame.js';
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

test('unchanged OCR game clock cannot verify a frozen replay frame',()=>{
  const stats=new Store().data.state.liveGameStats;
  const a=sample(100000,30);const b=sample(105000,30);
  assert.equal(Object.keys(trustedLiveUpdates(stats,a,b)).length,0);
});
