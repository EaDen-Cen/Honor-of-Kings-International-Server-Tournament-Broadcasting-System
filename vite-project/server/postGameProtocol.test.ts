import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/shared/types.js';
import type {PostGameReport} from '../src/shared/postGame.js';
import {isMatchSnapshot,parseMatchMessage} from '../src/shared/matchProtocol.js';

test('postgame extensions preserve the cloud transport guard and reject malformed grade and curve payloads',()=>{
  const report:PostGameReport={id:'game-1',gameNumber:1,seriesFormat:'BO3',stage:'Final',selectedMvpPlayerId:null,selectedMvpRowId:null,mvpArtScale:1,
    players:Array.from({length:10},(_,i)=>({rowId:`row-${i}`,playerId:`P${i}`,side:i<5?'blue':'red',slot:i%5,rosterIndex:i%5,teamName:'Team',portrait:'',role:'jungle',heroId:1,fields:{gold:{value:7589,sourcePage:'summary',confidence:1,manual:true,resolution:1}},grade:{value:'B',sourcePage:'summary',confidence:.95,manual:false}})),
    goldDifference:{points:[{timeSeconds:0,difference:0},{timeSeconds:590,difference:8500}],source:'settlement',confidence:.95,maxDifference:10700,partial:true,durationSeconds:660}};
  const snapshot={type:'match_state_update',revision:1,state:{...initialState(),postGameReports:[report]}};
  assert.equal(isMatchSnapshot(snapshot),true);
  assert.deepEqual(parseMatchMessage(JSON.stringify(snapshot)),snapshot);
  for(const update of [
    (value:PostGameReport)=>{Object.assign(value.players[0].grade!,{value:{text:'B'}});},
    (value:PostGameReport)=>{Object.assign(value.players[0].fields.gold!,{resolution:'100'});},
    (value:PostGameReport)=>{Object.assign(value.goldDifference!,{points:[null]});},
    (value:PostGameReport)=>{Object.assign(value.goldDifference!,{partial:'true'});},
    (value:PostGameReport)=>{Object.assign(value.goldDifference!,{durationSeconds:660.5});},
    (value:PostGameReport)=>{Object.assign(value,{mvpArtScale:'1.5'});},
  ]){
    const invalid=structuredClone(snapshot);update(invalid.state.postGameReports[0]);
    assert.equal(isMatchSnapshot(invalid),false);
    assert.equal(parseMatchMessage(JSON.stringify(invalid)),undefined);
  }
});
