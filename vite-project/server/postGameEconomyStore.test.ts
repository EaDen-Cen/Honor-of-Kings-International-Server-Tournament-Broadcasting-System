import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './store.js';
import {initialState,phases,type Action} from '../src/shared/types.js';
import type {GoldDifferenceTimeline} from '../src/shared/postGameTimeline.js';
test('economy curve and recap save atomically, manual curves survive OCR, zoom is validated and undoable',()=>{
  const s=new Store(),apply=(action:Action)=>s.apply('economy-'+Math.random().toString(36).slice(2),s.data.revision,action);
  apply({type:'settings',settings:initialState()});
  for(const phase of phases('match','blue')){
    if(phase.action==='ban')apply({type:'skip_ban',team:phase.team});
    else apply({type:'draft_action',team:phase.team,action:'pick',heroId:1+s.data.state.bluePicks.length+s.data.state.redPicks.length});
  }
  apply({type:'commit_game'});apply({type:'post_game_begin'});
  const report=()=>s.data.state.postGameReports[0],reportId=report().id;
  const curve:GoldDifferenceTimeline={source:'settlement',confidence:.95,maxDifference:800,points:[{timeSeconds:0,difference:0},{timeSeconds:60,difference:-400},{timeSeconds:120,difference:200}]};
  const before=s.data.revision;
  apply({type:'post_game_team_fields',reportId,updates:[{side:'blue',metric:'gold',field:{value:41900,sourcePage:'recap',confidence:.95,manual:false}}],goldDifference:curve});
  assert.equal(s.data.revision,before+1);assert.equal(report().teamFields?.blue?.gold?.value,41900);assert.deepEqual(report().goldDifference,curve);
  apply({type:'post_game_team_fields',reportId,updates:[],goldDifference:{...curve,partial:true,confidence:.99,points:curve.points.slice(0,2)}});
  assert.equal(report().goldDifference?.points.length,3,'partial OCR cannot replace a complete saved curve');
  apply({type:'undo'});
  apply({type:'undo'});assert.equal(report().goldDifference,undefined);assert.equal(report().teamFields,undefined);
  assert.throws(()=>apply({type:'post_game_team_fields',reportId,updates:[{side:'blue',metric:'gold',field:{value:41900,sourcePage:'recap',confidence:.95,manual:false}}],goldDifference:{...curve,points:[{timeSeconds:0,difference:0},{timeSeconds:0,difference:200}]}}),/curve/);assert.equal(report().teamFields,undefined);
  apply({type:'post_game_team_fields',reportId,updates:[],goldDifference:{...curve,partial:true,confidence:.99,points:curve.points.slice(0,2)}});
  assert.equal(report().goldDifference?.partial,true);
  apply({type:'post_game_team_fields',reportId,updates:[],goldDifference:curve});assert.equal(report().goldDifference?.points.length,3);assert.equal(report().goldDifference?.partial,undefined,'complete trusted capture refines a partial one');
  apply({type:'post_game_team_fields',reportId,updates:[],goldDifference:{...curve,source:'manual',confidence:1}});
  apply({type:'post_game_team_fields',reportId,updates:[],goldDifference:{...curve,points:[{timeSeconds:0,difference:0},{timeSeconds:60,difference:700}]}});
  assert.equal(report().goldDifference?.source,'manual');assert.equal(report().goldDifference?.points[1].difference,-400);
  apply({type:'post_game_mvp_art_scale',reportId,scale:1.15});assert.equal(report().mvpArtScale,1.15);
  assert.throws(()=>apply({type:'post_game_mvp_art_scale',reportId,scale:.5}),/scale/);assert.throws(()=>apply({type:'post_game_mvp_art_scale',reportId,scale:NaN}),/scale/);
  apply({type:'undo'});assert.equal(report().mvpArtScale,undefined);
});
