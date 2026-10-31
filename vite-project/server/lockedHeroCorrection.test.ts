import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { phases, type Action } from '../src/shared/types.js';
import heroes from '../src/components/HeroList.js';

const apply = (s: Store, a: Action) => s.apply(randomUUID(), s.data.revision, a);
const draft = (s: Store, offset = 0) =>
  phases('match').forEach((phase, index) => apply(s, {type:'draft_action',...phase,heroId:heroes[index+offset].id}));

test('locked Ban and Pick corrections do not rewind BP and reject duplicates atomically', () => {
  const s = new Store();
  phases('match').slice(0,8).forEach((phase,index)=>apply(s,{type:'draft_action',...phase,heroId:heroes[index].id}));
  const beforePhase=s.data.state.currentPhase;
  apply(s,{type:'replace_draft_hero',team:'blue',action:'ban',index:0,heroId:heroes[70].id});
  assert.equal(s.data.state.blueBans[0],heroes[70].id);
  assert.equal(s.data.state.currentPhase,beforePhase);
  const snapshot=structuredClone(s.data);
  assert.throws(()=>apply(s,{type:'replace_draft_hero',team:'red',action:'ban',index:0,heroId:heroes[70].id}));
  assert.throws(()=>apply(s,{type:'replace_draft_hero',team:'blue',action:'pick',index:4,heroId:heroes[80].id}));
  assert.deepEqual(s.data,snapshot);
  apply(s,{type:'undo'});
  assert.equal(s.data.state.blueBans[0],heroes[0].id);
});

test('operator can correct committed hero while preserving manual postgame data and archival reports', () => {
  const s=new Store();
  draft(s);apply(s,{type:'commit_game'});
  const firstId=s.data.state.committedGameId!;
  const firstReport=s.data.state.postGameReports[0];
  assert.equal(s.data.state.activePostGameReportId,firstId);
  const old=s.data.state.bluePicks[0];
  apply(s,{type:'post_game_fields',reportId:firstId,updates:[{rowId:firstReport.players[0].rowId,metric:'kills',field:{value:12,confidence:1,manual:true,sourcePage:'summary'}}]});
  apply(s,{type:'replace_draft_hero',team:'blue',action:'pick',index:0,heroId:heroes[75].id});
  assert.notEqual(old,heroes[75].id);
  assert.equal(s.data.state.bluePicks[0],heroes[75].id);
  assert.equal(s.data.state.draftHistory[0].bluePicks[0],heroes[75].id);
  assert.equal(s.data.state.postGameReports[0].players[0].heroId,heroes[75].id);
  assert.equal(s.data.state.postGameReports[0].players[0].fields.kills?.value,12);
  apply(s,{type:'score',team:'blue',delta:1});apply(s,{type:'next_game'});
  assert.equal(s.data.state.postGameReports[0].players[0].fields.kills?.value,12);
  draft(s,25);apply(s,{type:'commit_game'});
  const secondId=s.data.state.committedGameId!;
  assert.notEqual(firstId,secondId);
  assert.equal(s.data.state.activePostGameReportId,secondId);
  assert.equal(s.data.state.postGameReports.length,2);
  apply(s,{type:'replace_draft_hero',team:'blue',action:'pick',index:0,heroId:heroes[90].id,gameId:firstId});
  assert.equal(s.data.state.draftHistory[0].bluePicks[0],heroes[90].id);
  assert.equal(s.data.state.postGameReports[0].players[0].heroId,heroes[90].id);
  assert.equal(s.data.state.postGameReports[1].players[0].heroId,s.data.state.blueAssignments[0]);
  assert.equal(s.data.state.postGameReports[0].players[0].fields.kills?.value,12);
  const before=structuredClone(s.data);
  assert.throws(()=>apply(s,{type:'replace_draft_hero',team:'blue',action:'pick',index:0,heroId:999999,gameId:firstId}));
  assert.throws(()=>apply(s,{type:'replace_draft_hero',team:'blue',action:'pick',index:0,heroId:heroes[50].id,gameId:'wrong-id'}));
  assert.deepEqual(s.data,before);
});
