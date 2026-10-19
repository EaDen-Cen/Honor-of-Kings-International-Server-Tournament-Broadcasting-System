import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import heroes from '../src/components/HeroList.js';
import { initialState, phases, type Action, type MatchState, type DraftRuleMode } from '../src/shared/types.js';
import { draftHeroUsed, draftRestriction } from '../src/shared/draftRules.js';
import { lineupIdentityContext, lineupWriteContext } from '../src/shared/lineupContext.js';
import { Store } from './store.js';

const apply=(store:Store,action:Action)=>store.apply(randomUUID(),store.data.revision,action);
function fill(store:Store) {
  while(!store.data.state.draftComplete) {
    const state=store.data.state,phase=phases(state.draftMode,state.firstPickSide,state.banCount)[state.currentPhase];
    const hero=heroes.find(hero=>!draftHeroUsed(state,hero.id)&&!draftRestriction(state,phase.team,phase.action,hero.id));
    assert.ok(hero);
    apply(store,{type:'draft_action',...phase,heroId:hero.id});
  }
}
function prepare(store=new Store(),rule:DraftRuleMode='normal',firstPickSide:'blue'|'red'='blue') {
  const state=initialState();
  state.banCount=0;state.seriesFormat='BO5';state.draftRuleMode=rule;state.firstPickSide=firstPickSide;
  state.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];
  state.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];
  apply(store,{type:'settings',settings:state});fill(store);return store;
}
const assignment=(store:Store,blue:number[],red:number[],context=lineupWriteContext(store.data.state)):Action=>({type:'set_lineup_assignments',blue,red,expectedContext:context});
function rejectsAtomically(store:Store,action:Action,pattern:RegExp) {
  const before=structuredClone(store.data);
  assert.throws(()=>apply(store,action),pattern);
  assert.deepEqual(store.data,before,'rejection must preserve revision, IDs, undo, events and both teams');
}

test('lineup contexts include binding identity and exclude unrelated display, HUD and revision changes',()=>{
  const state=prepare().data.state,identity=lineupIdentityContext(state),write=lineupWriteContext(state);
  for(const mutate of [
    (next:MatchState)=>{next.gameNumber++;},
    (next:MatchState)=>{next.draftGameNumber=2;},
    (next:MatchState)=>{next.currentPhase--;},
    (next:MatchState)=>{next.draftComplete=false;},
    (next:MatchState)=>{next.committedGameId='committed-another-game';},
    (next:MatchState)=>{next.displayLeftSide='red';},
    (next:MatchState)=>{next.firstPickSide='red';},
    (next:MatchState)=>{next.sideSwapMode='colorsOnly';},
    (next:MatchState)=>{next.blueTeam.id='another-blue-team';},
    (next:MatchState)=>{next.redTeam.id='another-red-team';},
    (next:MatchState)=>{next.blueTeam.players[0]='Substitute';},
    (next:MatchState)=>{next.redTeam.players[0]='Substitute';},
    (next:MatchState)=>{next.blueTeam.playerRoles[0]='jungle';},
    (next:MatchState)=>{next.bluePicks.reverse();},
    (next:MatchState)=>{next.redPicks.reverse();},
    (next:MatchState)=>{next.bluePlayerSlotOrder.reverse();},
    (next:MatchState)=>{next.redPlayerSlotOrder.reverse();},
  ]) {
    const next=structuredClone(state);mutate(next);
    assert.notEqual(lineupIdentityContext(next),identity);
    assert.notEqual(lineupWriteContext(next),write);
  }
  const swapped=structuredClone(state);swapped.blueAssignments.reverse();
  assert.equal(lineupIdentityContext(swapped),identity);
  assert.notEqual(lineupWriteContext(swapped),write,'a newer manual ownership change must invalidate an old write');
  const unrelated=structuredClone(state);
  unrelated.language='eng';unrelated.overlayLayout='side';unrelated.stage='Final';
  unrelated.blueTeam.name='Renamed';unrelated.redTeam.playerPortraits[0]='/photo.png';
  unrelated.liveGameStats.blueKills=20;
  Object.assign(unrelated,{revision:999,disabled:true});
  assert.equal(lineupIdentityContext(unrelated),identity);
  assert.equal(lineupWriteContext(unrelated),write);
});

test('help-picks and repeated exchanges persist by nondefault P1–P5 order without rewriting draft picks',()=>{
  const root=mkdtempSync(join(tmpdir(),'hok-final-lineup-')),file=join(root,'match.json');
  try {
    const store=prepare(new Store(file)),state=store.data.state;
    const bluePicks=[...state.bluePicks],redPicks=[...state.redPicks];
    const blueOrder=[4,0,3,1,2],redOrder=[1,3,0,4,2];
    apply(store,{type:'set_player_slot_orders',blue:blueOrder,red:redOrder,expectedPlayers:[state.blueTeam.players,state.redTeam.players]});
    const identity=lineupIdentityContext(store.data.state);
    for(const order of [[1,0,2,4,3],[4,3,2,1,0],[2,4,1,0,3]]) {
      const blue=order.map(index=>bluePicks[index]),red=[...order].reverse().map(index=>redPicks[index]);
      const revision=store.data.revision;
      apply(store,assignment(store,blue,red));
      assert.equal(store.data.revision,revision+1);
      assert.deepEqual(store.snapshot('overlay').state.blueAssignments,blue);
      assert.deepEqual(new Store(file).data.state.redAssignments,red);
      assert.deepEqual(store.data.state.bluePicks,bluePicks);
      assert.deepEqual(store.data.state.redPicks,redPicks);
      assert.equal(lineupIdentityContext(store.data.state),identity);
    }
    const final=structuredClone(store.data.state);
    apply(store,{type:'commit_game'});apply(store,{type:'post_game_begin'});
    const report=new Store(file).data.state.postGameReports[0];
    for(const side of ['blue','red'] as const)for(let slot=0;slot<5;slot++) {
      const player=report.players.find(player=>player.side===side&&player.slot===slot)!;
      const rosterIndex=final[`${side}PlayerSlotOrder`][slot];
      assert.equal(player.rosterIndex,rosterIndex);
      assert.equal(player.playerId,final[`${side}Team`].players[rosterIndex]);
      assert.equal(player.role,final[`${side}Team`].playerRoles[rosterIndex]);
      assert.equal(player.heroId,final[`${side}Assignments`][slot]);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('stale candidates cannot overwrite manual exchanges, roster corrections or slot-order corrections',()=>{
  for(const intervene of [
    (store:Store)=>apply(store,{type:'swap_assignments',team:'blue',from:0,to:1}),
    (store:Store)=>apply(store,{type:'swap_assignments',team:'red',from:0,to:1}),
    (store:Store)=>apply(store,{type:'set_player_slot_order',side:'blue',order:[4,3,2,1,0],expectedPlayers:store.data.state.blueTeam.players}),
    (store:Store)=>apply(store,{type:'set_player_slot_order',side:'red',order:[4,3,2,1,0],expectedPlayers:store.data.state.redTeam.players}),
    (store:Store)=>apply(store,{type:'settings',settings:{...store.data.state,blueTeam:{...store.data.state.blueTeam,players:['Substitute',...store.data.state.blueTeam.players.slice(1)]}}}),
  ]) {
    const store=prepare(),context=lineupWriteContext(store.data.state);
    const blue=[...store.data.state.bluePicks].reverse(),red=[...store.data.state.redPicks].reverse();
    intervene(store);
    rejectsAtomically(store,assignment(store,blue,red,context),/Lineup context changed/);
  }
});

test('red-first drafts save final ownership with the same independent team-slot context',()=>{
  const store=prepare(new Store(),'normal','red'),before=structuredClone(store.data.state);
  const blue=[...before.bluePicks].reverse(),red=[...before.redPicks.slice(1),before.redPicks[0]];
  apply(store,assignment(store,blue,red));
  assert.equal(store.data.state.firstPickSide,'red');
  assert.deepEqual(store.data.state.blueAssignments,blue);
  assert.deepEqual(store.data.state.redAssignments,red);
  assert.deepEqual(store.data.state.bluePicks,before.bluePicks);
  assert.deepEqual(store.data.state.redPicks,before.redPicks);
});

test('committed, reset and next-game or side-swap races reject the complete old write',()=>{
  const store=prepare();
  apply(store,{type:'settings',settings:{...store.data.state,sideSwapMode:'colorsOnly'}});
  const context=lineupWriteContext(store.data.state);
  const oldBlue=[...store.data.state.bluePicks].reverse(),oldRed=[...store.data.state.redPicks].reverse();
  apply(store,{type:'commit_game'});
  rejectsAtomically(store,assignment(store,oldBlue,oldRed,context),/Lineup context changed/);
  rejectsAtomically(store,{type:'set_lineup_assignments',blue:oldBlue,red:oldRed},/gameAlreadyCommitted/);
  apply(store,{type:'score',team:'blue',delta:1});apply(store,{type:'next_game'});
  rejectsAtomically(store,assignment(store,oldBlue,oldRed,context),/Lineup context changed/);
  apply(store,{type:'swap_sides'});fill(store);
  assert.equal(store.data.state.gameNumber,2);
  assert.equal(store.data.state.displayLeftSide,'red');
  assert.equal(store.data.state.blueTeam.players[0],'Fox');
  rejectsAtomically(store,assignment(store,oldBlue,oldRed,context),/Lineup context changed/);
  apply(store,assignment(store,[...store.data.state.bluePicks].reverse(),[...store.data.state.redPicks].reverse()));
  const current=lineupWriteContext(store.data.state);
  apply(store,{type:'reset_draft'});
  rejectsAtomically(store,assignment(store,oldBlue,oldRed,current),/Lineup context changed/);
});

test('unrelated live settings and HUD updates retain the context while stale global revisions remain rejected',()=>{
  const store=prepare(),context=lineupWriteContext(store.data.state),oldRevision=store.data.revision;
  const blue=[...store.data.state.bluePicks].reverse(),red=[...store.data.state.redPicks].reverse();
  apply(store,{type:'settings',settings:{...store.data.state,language:'eng',stage:'Grand final',blueTeam:{...store.data.state.blueTeam,name:'Renamed team'}}});
  apply(store,{type:'live_game_stats',stats:{...store.data.state.liveGameStats,blueKills:4,blueGold:8000}});
  apply(store,{type:'delay',seconds:0});
  assert.equal(lineupWriteContext(store.data.state),context);
  const before=structuredClone(store.data);
  assert.throws(()=>store.apply(randomUUID(),oldRevision,assignment(store,blue,red,context)),/比赛状态已更新/);
  assert.deepEqual(store.data,before);
  apply(store,assignment(store,blue,red,context));
  assert.deepEqual(store.data.state.blueAssignments,blue);
});

test('context-matched writes retain both-team permutation checks, legacy compatibility and personal BP restrictions',()=>{
  const store=prepare(),blue=[...store.data.state.bluePicks],red=[...store.data.state.redPicks];
  for(const action of [
    assignment(store,[blue[0],blue[0],...blue.slice(2)],red),
    assignment(store,blue,[red[0],red[0],...red.slice(2)]),
    assignment(store,[red[0],...blue.slice(1)],red),
    assignment(store,blue,red.slice(0,4)),
    {...assignment(store,blue,red),expectedContext:''},
    {...assignment(store,blue,red),expectedContext:null as unknown as string},
    {...assignment(store,blue,red),expectedContext:3 as unknown as string},
  ])rejectsAtomically(store,action,/lineupInvalid|Lineup context changed/);
  apply(store,{type:'set_lineup_assignments',blue:[...blue].reverse(),red:[...red].reverse()});
  assert.deepEqual(store.data.state.blueAssignments,[...blue].reverse(),'old clients remain supported');
  const personal=prepare(new Store(),'player');
  apply(personal,{type:'commit_game'});apply(personal,{type:'score',team:'blue',delta:1});apply(personal,{type:'next_game'});fill(personal);
  const blueHeld=[...personal.data.state.bluePicks],redHeld=[...personal.data.state.redPicks];
  apply(personal,assignment(personal,[...blueHeld.slice(1),blueHeld[0]],[...redHeld.slice(1),redHeld[0]]));
  rejectsAtomically(personal,assignment(personal,blueHeld,redHeld),/usedByPlayer/);
});

test('a context-matched persistence failure does not publish, consume the request or alter the saved match',()=>{
  const root=mkdtempSync(join(tmpdir(),'hok-lineup-storage-')),file=join(root,'match.json');
  try {
    const store=prepare(new Store(file));
    const action=assignment(store,[...store.data.state.bluePicks].reverse(),[...store.data.state.redPicks].reverse());
    const before=structuredClone(store.data),saved=readFileSync(file,'utf8'),id=randomUUID();
    mkdirSync(file+'.tmp');
    assert.throws(()=>store.apply(id,store.data.revision,action),/比赛状态保存失败/);
    assert.deepEqual(store.data,before);
    assert.equal(readFileSync(file,'utf8'),saved);
    assert.deepEqual(new Store(file).data.state.blueAssignments,before.state.blueAssignments);
    rmdirSync(file+'.tmp');
    store.apply(id,store.data.revision,action);
    assert.equal(store.data.revision,before.revision+1);
    assert.deepEqual(new Store(file).data.state.blueAssignments,(action as Extract<Action,{type:'set_lineup_assignments'}>).blue);
  } finally {rmSync(root,{recursive:true,force:true});}
});
