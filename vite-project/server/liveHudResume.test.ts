import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from './store.js';
import {liveGameContext,type LiveHudSample} from '../src/shared/liveGame.js';
import {liveCaptureKeys} from '../src/shared/gameCapture.js';

const sample=(capturedAt:number,time:number,kills:number,gold:number):LiveHudSample=>({capturedAt,profile:'same calibrated source',candidates:liveCaptureKeys.map(key=>({key,value:key==='gameTimeSeconds'?time:key.endsWith('Gold')?gold:key.endsWith('Kills')?kills:0,confidence:.96,text:''}))});
test('two fresh HUD reads recover after a capture interruption while protecting manual fields and plausible trends',()=>{
  let now=100000;
  const store=new Store(undefined,()=>now),context=liveGameContext(store.data.state);
  const publish=(previous:LiveHudSample,current:LiveHudSample)=>store.apply(randomUUID(),store.data.revision,{type:'live_game_ocr',context,previous,sample:current});
  publish(sample(now-5000,25,4,5000),sample(now,30,4,5000));
  store.apply(randomUUID(),store.data.revision,{type:'live_game_stats',stats:{...store.data.state.liveGameStats,blueGold:7000}});
  now+=65000;
  publish(sample(now-5000,90,13,14000),sample(now,95,13,14000));
  const stats=store.data.state.liveGameStats;
  assert.equal(stats.gameTimeSeconds,95);
  assert.equal(stats.redKills,13);
  assert.equal(stats.redGold,14000);
  assert.equal(stats.blueGold,7000,'manually edited economy remains frozen');
  now+=5000;
  publish(sample(now-5000,95,190,990000),sample(now,100,190,990000));
  assert.equal(store.data.state.liveGameStats.redKills,13,'an implausible jump is still rejected after resumption');
  assert.equal(store.data.state.liveGameStats.redGold,14000);
  assert.equal(store.data.state.liveGameStats.gameTimeSeconds,100);
  now+=65000;
  assert.throws(()=>publish(sample(now-5000,160,14,15000),sample(now,160,14,15000)),/No consistent/,'a frozen screenshot is not a resumed live capture');
});
