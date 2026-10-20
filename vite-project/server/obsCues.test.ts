import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendedObsCue,resolveObsCue,parseObsCueMap } from '../src/control/obsCues.js';

test('OBS stage recommendation follows authoritative match state without side effects',()=>{
  const state={currentPhase:0,draftComplete:false,committedGameId:null,activePostGameReportId:null};
  assert.equal(recommendedObsCue(state),'waiting');
  assert.equal(recommendedObsCue({...state,currentPhase:2}),'draft');
  assert.equal(recommendedObsCue({...state,draftComplete:true}),'draft');
  assert.equal(recommendedObsCue({...state,committedGameId:'game-1'}),'game');
  assert.equal(recommendedObsCue({...state,committedGameId:'game-1',activePostGameReportId:'report-1'}),'postgame');
});

test('OBS scene cues require exact scene names, respect explicit mapping and reject stale mappings',()=>{
  const scenes=['Waiting','BP','Game','Game 2','MVP'];
  assert.equal(resolveObsCue('draft',scenes,{}),'BP');
  assert.equal(resolveObsCue('game',scenes,{}),'Game');
  assert.equal(resolveObsCue('game',scenes,{game:'Game 2'}),'Game 2');
  assert.equal(resolveObsCue('game',scenes,{game:'Deleted scene'}),null);
  assert.equal(resolveObsCue('pause',scenes,{}),null);
  assert.equal(resolveObsCue('game',['Game preview'],{}),null);
});

test('OBS cue settings safely parse local operator mapping',()=>{
  assert.deepEqual(parseObsCueMap(null),{});
  assert.deepEqual(parseObsCueMap('{broken'),{});
  assert.deepEqual(parseObsCueMap(JSON.stringify({game:'Live',draft:'BP',other:'unexpected',safe:42})),{draft:'BP',game:'Live'});
});
