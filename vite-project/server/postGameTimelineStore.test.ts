import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.js';
import { initialState,phases } from '../src/shared/types.js';
const apply=(s:Store,action:Parameters<Store['apply']>[2])=>s.apply('timeline-'+Math.random().toString(36).slice(2,13),s.data.revision,action);
test('timeline observations are per-game, validated, persisted and undoable',()=>{
 const s=new Store();
 const settings=initialState();
 apply(s,{type:'settings',settings});
 for(const phase of phases('match','blue')){
  if(phase.action==='ban')apply(s,{type:'skip_ban',team:phase.team});
  else{
   const heroId=1+s.data.state.bluePicks.length+s.data.state.redPicks.length;
   apply(s,{type:'draft_action',team:phase.team,action:'pick',heroId});
  }
 }
 apply(s,{type:'commit_game'});apply(s,{type:'post_game_begin'});
 const id=s.data.state.activePostGameReportId!;
 const points=[{timeSeconds:120,blueGold:3000,redGold:3100},{timeSeconds:600,blueGold:13000,redGold:12800}];
 apply(s,{type:'post_game_gold_timeline',reportId:id,points});
 assert.deepEqual(s.data.state.postGameReports[0].goldTimeline,points);
 assert.throws(()=>apply(s,{type:'post_game_gold_timeline',reportId:id,points:[points[1],points[0]]}));
 apply(s,{type:'undo'});assert.equal(s.data.state.postGameReports[0].goldTimeline,undefined);
});
