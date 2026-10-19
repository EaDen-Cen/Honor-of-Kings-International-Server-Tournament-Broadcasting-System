import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/shared/types.js';
import { canVerifyPlayerOrder, playerOrderCheckKey } from '../src/shared/playerOrderPreflight.js';

function readyState(){
  const state=initialState();
  state.blueTeam.players=['Blue1','Blue2','Blue3','Blue4','Blue5'];
  state.redTeam.players=['Red1','Red2','Red3','Red4','Red5'];
  return state;
}

test('preflight remains acknowledged throughout a draft, but not after a new game',()=>{
  const state=readyState();
  const key=playerOrderCheckKey(state);
  state.currentPhase=3;
  state.draftHistory.push({} as typeof state.draftHistory[number]);
  assert.equal(playerOrderCheckKey(state),key,'BP progress must not erase preflight');
  state.gameNumber++;
  assert.notEqual(playerOrderCheckKey(state),key);
});

test('roster or authoritative P1–P5 changes invalidate human confirmation',()=>{
  const state=readyState();
  const key=playerOrderCheckKey(state);
  state.bluePlayerSlotOrder=[1,0,2,3,4];
  assert.notEqual(playerOrderCheckKey(state),key);
  state.bluePlayerSlotOrder=[0,1,2,3,4];
  state.redTeam.players[2]='Substitute';
  assert.notEqual(playerOrderCheckKey(state),key);
});

test('human preflight is disabled for incomplete, duplicate or invalid rosters',()=>{
  const state=readyState();
  assert.equal(canVerifyPlayerOrder(state),true);
  state.redTeam.players[4]='';
  assert.equal(canVerifyPlayerOrder(state),false);
  state.redTeam.players[4]='Red1';
  assert.equal(canVerifyPlayerOrder(state),false);
  state.redTeam.players[4]='Red5';
  state.bluePlayerSlotOrder=[0,0,2,3,4];
  assert.equal(canVerifyPlayerOrder(state),false);
});
