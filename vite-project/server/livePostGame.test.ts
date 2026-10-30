import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { initialState,phases,type Action } from '../src/shared/types.js';
import heroes from '../src/components/HeroList.js';
import { highlightStats } from '../src/shared/postGame.js';
const apply=(s:Store,a:Action)=>s.apply(randomUUID(),s.data.revision,a);
function complete(s:Store){phases('match').forEach((phase,index)=>apply(s,{type:'draft_action',...phase,heroId:heroes[index].id}));apply(s,{type:'commit_game'});}
test('HUD bounds, undo, persistence snapshots, configurable objectives and next-game reset',()=>{
  let now=1000000;const s=new Store(undefined,()=>now),stats={...s.data.state.liveGameStats,blueKills:8,redKills:5,blueTowers:3,neutralObjectives:[{id:'resource',name:'Custom',icon:'/resource.png',blue:2,red:1}]};
  apply(s,{type:'live_game_stats',stats});assert.equal(s.snapshot('overlay').state.liveGameStats.blueKills,8);
  assert.equal(s.snapshot('caster').state.liveGameStats.blueKills,0);now+=180000;assert.equal(s.snapshot('caster').state.liveGameStats.blueKills,8);
  assert.throws(()=>apply(s,{type:'live_game_stats',stats:{...stats,blueKills:-1}}));
  assert.throws(()=>apply(s,{type:'live_game_stats',stats:{...stats,neutralObjectives:[{...stats.neutralObjectives[0],icon:'javascript:alert(1)'}]}}));
  apply(s,{type:'undo'});assert.equal(s.data.state.liveGameStats.blueKills,0);
  apply(s,{type:'live_game_stats',stats});complete(s);apply(s,{type:'score',team:'blue',delta:1});apply(s,{type:'next_game'});
  assert.equal(s.data.state.liveGameStats.blueKills,0);assert.equal(s.data.state.liveGameStats.neutralObjectives[0].name,'Custom');assert.equal(s.data.state.liveGameStats.neutralObjectives[0].blue,0);
});
test('BO3 can prepare and edit the first report after starting the second game',()=>{
  const s=new Store();complete(s);
  const firstId=s.data.state.committedGameId!;
  apply(s,{type:'score',team:'blue',delta:1});apply(s,{type:'next_game'});
  apply(s,{type:'post_game_begin'});
  assert.equal(s.data.state.activePostGameReportId,firstId);
  const report=s.data.state.postGameReports[0];
  apply(s,{type:'post_game_fields',reportId:firstId,updates:[{rowId:report.players[0].rowId,metric:'kills',field:{value:7,confidence:1,manual:true,sourcePage:'summary'}}]});
  assert.equal(s.data.state.postGameReports[0].players[0].fields.kills?.value,7);
  assert.equal(s.data.state.committedGameId,null);
  assert.equal(s.data.state.gameNumber,2);
  complete(s);const secondId=s.data.state.committedGameId!;
  apply(s,{type:'post_game_begin'});
  assert.equal(s.data.state.activePostGameReportId,secondId);
  const second=s.data.state.postGameReports[1];
  apply(s,{type:'post_game_fields',reportId:secondId,updates:[{rowId:second.players[0].rowId,metric:'kills',field:{value:2,confidence:.95,manual:false,sourcePage:'summary'}}]});
  assert.equal(s.data.state.postGameReports[1].players[0].fields.kills?.value,2);
  apply(s,{type:'post_game_begin',gameId:firstId});
  apply(s,{type:'post_game_fields',reportId:firstId,updates:[{rowId:report.players[0].rowId,metric:'kills',field:{value:8,confidence:1,manual:true,sourcePage:'summary'}}]});
  assert.equal(s.data.state.postGameReports[0].players[0].fields.kills?.value,8);
  assert.equal(s.data.state.postGameReports[1].players[0].fields.kills?.value,2);
  const before=structuredClone(s.data);
  assert.throws(()=>apply(s,{type:'post_game_begin',gameId:'missing-game'}));
  assert.deepEqual(s.data,before);
});

test('team recap keeps side identity and trusted fields through repeated collection, manual correction and undo',()=>{
  const s=new Store();complete(s);apply(s,{type:'post_game_begin'});const report=s.data.state.postGameReports[0];
  const field={value:38600,confidence:.9,manual:false,sourcePage:'recap' as const,capturedAt:100};
  apply(s,{type:'post_game_team_fields',reportId:report.id,updates:[{side:'red',metric:'gold',field}]});
  apply(s,{type:'post_game_team_fields',reportId:report.id,updates:[{side:'red',metric:'gold',field:{...field,value:88600,confidence:.99}}]});
  assert.equal(s.data.state.postGameReports[0].teamFields?.red?.gold?.value,38600);
  assert.equal(s.data.state.postGameReports[0].teamFields?.blue?.gold,undefined);
  apply(s,{type:'post_game_team_fields',reportId:report.id,updates:[{side:'red',metric:'gold',field:{...field,value:38000,manual:true}}]});
  assert.equal(s.data.state.postGameReports[0].teamFields?.red?.gold?.value,38000);
  apply(s,{type:'undo'});assert.equal(s.data.state.postGameReports[0].teamFields?.red?.gold?.value,38600);
  assert.throws(()=>apply(s,{type:'post_game_team_fields',reportId:report.id,updates:[{side:'red',metric:'gold',field:{...field,value:-1}}]}));
});
test('post-game identity snapshots follow committed mappings, merge pages and never auto-select MVP',()=>{
  const s=new Store(),base=initialState();base.blueTeam.players=['A','B','C','D','E'];base.redTeam.players=['F','G','H','I','J'];
  apply(s,{type:'settings',settings:base});apply(s,{type:'set_player_slot_order',side:'blue',order:[4,3,2,1,0],expectedPlayers:base.blueTeam.players});
  assert.throws(()=>apply(s,{type:'post_game_begin'}));complete(s);apply(s,{type:'post_game_begin'});
  const report=s.data.state.postGameReports[0];assert.equal(report.players.length,10);assert.equal(report.players[0].playerId,'E');assert.equal(report.selectedMvpPlayerId,null);
  const field={value:20,sourcePage:'damage' as const,confidence:.9,manual:false};
  apply(s,{type:'post_game_fields',reportId:report.id,updates:[{rowId:report.players[0].rowId,metric:'damageShare',field},{rowId:report.players[0].rowId,metric:'healing',field:{...field,value:1000,confidence:.4}}]});
  const player=s.data.state.postGameReports[0].players[0];assert.deepEqual(highlightStats(player).map(v=>v.key),['damageShare']);
  for(const candidate of [{...field,value:80,confidence:.99},{...field,value:10,confidence:.4}]){
    apply(s,{type:'post_game_fields',reportId:report.id,updates:[{rowId:player.rowId,metric:'damageShare',field:candidate}]});
    assert.equal(s.data.state.postGameReports[0].players[0].fields.damageShare?.value,20);
  }
  assert.equal(s.data.state.postGameReports[0].selectedMvpPlayerId,null);
  assert.throws(()=>apply(s,{type:'post_game_fields',reportId:report.id,updates:[{rowId:player.rowId,metric:'participation',field:{...field,value:101}}]}));
  apply(s,{type:'post_game_fields',reportId:report.id,updates:[{rowId:player.rowId,metric:'healing',field:{...field,value:1000,sourcePage:'team',manual:true,confidence:.4}}]});
  assert.deepEqual(highlightStats(s.data.state.postGameReports[0].players[0]).map(v=>v.key),['healing','damageShare']);
  apply(s,{type:'select_mvp',reportId:report.id,rowId:player.rowId});assert.equal(s.data.state.postGameReports[0].selectedMvpPlayerId,'E');
  apply(s,{type:'score',team:'blue',delta:1});apply(s,{type:'next_game'});assert.equal(s.data.state.postGameReports[0].players[0].playerId,'E');
  apply(s,{type:'select_mvp',reportId:report.id,rowId:null});assert.equal(s.data.state.postGameReports[0].selectedMvpPlayerId,null);
});
