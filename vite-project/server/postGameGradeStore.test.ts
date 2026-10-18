import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './store.js';
import {initialState,phases,type Action} from '../src/shared/types.js';

test('letter grades persist separately, protect manual choices and support undo; precise gold wins in either page order',()=>{
  const s=new Store(),apply=(action:Action)=>s.apply('grade-'+Math.random().toString(36).slice(2),s.data.revision,action);
  apply({type:'settings',settings:initialState()});
  for(const phase of phases('match','blue')){
    if(phase.action==='ban')apply({type:'skip_ban',team:phase.team});
    else apply({type:'draft_action',team:phase.team,action:'pick',heroId:1+s.data.state.bluePicks.length+s.data.state.redPicks.length});
  }
  apply({type:'commit_game'});apply({type:'post_game_begin'});
  const report=()=>s.data.state.postGameReports[0],reportId=report().id,rowId=report().players[0].rowId;
  const before=s.data.revision;
  apply({type:'post_game_fields',reportId,updates:[{rowId,metric:'gold',field:{value:7600,resolution:100,sourcePage:'economy',confidence:.95,manual:false}}],grades:[{rowId,field:{value:'B',sourcePage:'summary',confidence:.95,manual:false}}]});
  assert.equal(s.data.revision,before+1);assert.equal(report().players[0].fields.gold?.value,7600);assert.equal(report().players[0].grade?.value,'B');
  apply({type:'undo'});assert.equal(report().players[0].grade,undefined);assert.equal(report().players[0].fields.gold,undefined);
  assert.throws(()=>apply({type:'post_game_fields',reportId,updates:[{rowId,metric:'gold',field:{value:9999,sourcePage:'summary',confidence:1,manual:true}}],grades:[{rowId,field:{value:'9.8' as 'B',sourcePage:'summary',confidence:1,manual:true}}]}),/grade/);
  assert.equal(report().players[0].fields.gold,undefined,'invalid grade must reject the whole page before numeric fields change');
  apply({type:'post_game_grades',reportId,updates:[{rowId,field:{value:'A+',sourcePage:'summary',confidence:1,manual:true}}]});
  assert.equal(report().players[0].grade?.value,'A+');assert.equal(report().players[0].fields.rating,undefined);
  const rating=(value:number)=>apply({type:'post_game_fields',reportId,updates:[{rowId,metric:'rating',field:{value,sourcePage:'summary',confidence:1,manual:true}}]});
  rating(0);rating(100);const saved=structuredClone(s.data);
  assert.throws(()=>rating(101),/Rating must be/);assert.deepEqual(s.data,saved);
  apply({type:'post_game_grades',reportId,updates:[{rowId,field:{value:'B',sourcePage:'summary',confidence:.99,manual:false}}]});
  assert.equal(report().players[0].grade?.value,'A+');
  assert.throws(()=>apply({type:'post_game_grades',reportId,updates:[{rowId,field:{value:'9.8' as 'B',sourcePage:'summary',confidence:1,manual:true}}]}),/grade/);
  const setGold=(value:number,resolution:number)=>apply({type:'post_game_fields',reportId,updates:[{rowId,metric:'gold',field:{value,resolution,sourcePage:resolution===1?'summary':'economy',confidence:.95,manual:false}}]});
  setGold(7600,100);setGold(7589,1);assert.equal(report().players[0].fields.gold?.value,7589);
  setGold(7600,100);assert.equal(report().players[0].fields.gold?.value,7589);
  setGold(7500,100);assert.equal(report().players[0].fields.gold?.value,7589);
  apply({type:'post_game_grades',reportId,updates:[{rowId,field:{value:'S',sourcePage:'summary',confidence:1,manual:true}}]});
  apply({type:'undo'});assert.equal(report().players[0].grade?.value,'A+');
});
