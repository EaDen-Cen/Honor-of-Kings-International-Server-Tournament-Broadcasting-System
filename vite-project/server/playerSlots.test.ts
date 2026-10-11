import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { initialState, phases, type Action } from '../src/shared/types.js';
import { normalizeState, pickRestriction } from '../src/shared/draftRules.js';
import { playerAtSlot, solvePlayerSlotCandidates, solvePlayerSlots } from '../src/shared/playerSlots.js';
import { createCaptureSlotPreset, readCaptureSlotPresets } from '../src/control/captureSlotPresets.js';
import {
  createPlayerIdRegionPreset,
  readPlayerIdRegionPresets,
  updatePlayerIdRegionPreset,
} from '../src/control/playerIdRegionPresets.js';
import { defaultCaptureSlots } from '../src/control/bpCaptureLayout.js';
import heroes from '../src/components/HeroList.js';
const apply=(s:Store,a:Action)=>s.apply(randomUUID(),s.data.revision,a);
const ids=['Alpha','Bravo','Charlie','Delta','Echo'];
const permutations=(v:number[]):number[][]=>v.length<=1?[v]:v.flatMap((x,i)=>permutations(v.filter((_,j)=>i!==j)).map(r=>[x,...r]));
test('both player orders update and undo atomically; stale red roster or invalid red order changes neither side',()=>{
  const s=new Store(),base=initialState();base.blueTeam.players=[...ids];base.redTeam.players=ids.map(id=>'Red'+id);
  apply(s,{type:'settings',settings:base});
  const expectedPlayers:[string[],string[]]=[base.blueTeam.players,base.redTeam.players];
  const before=s.data.revision;
  for(const action of [
    {type:'set_player_slot_orders' as const,blue:[4,3,2,1,0],red:[0,0,2,3,4],expectedPlayers},
    {type:'set_player_slot_orders' as const,blue:[4,3,2,1,0],red:[4,3,2,1,0],expectedPlayers:[ids,ids] as [string[],string[]]},
  ])assert.throws(()=>apply(s,action));
  assert.equal(s.data.revision,before);
  assert.deepEqual(s.data.state.bluePlayerSlotOrder,[0,1,2,3,4]);
  assert.deepEqual(s.data.state.redPlayerSlotOrder,[0,1,2,3,4]);
  apply(s,{type:'set_player_slot_orders',blue:[4,3,2,1,0],red:[1,2,3,4,0],expectedPlayers});
  assert.equal(s.data.revision,before+1);
  assert.deepEqual(s.data.state.bluePlayerSlotOrder,[4,3,2,1,0]);
  assert.deepEqual(s.data.state.redPlayerSlotOrder,[1,2,3,4,0]);
  apply(s,{type:'undo'});
  assert.deepEqual(s.data.state.bluePlayerSlotOrder,[0,1,2,3,4]);
  assert.deepEqual(s.data.state.redPlayerSlotOrder,[0,1,2,3,4]);
  phases('match').forEach((phase,index)=>apply(s,{type:'draft_action',...phase,heroId:heroes[index].id}));
  apply(s,{type:'commit_game'});
  assert.throws(()=>apply(s,{type:'set_player_slot_orders',blue:[4,3,2,1,0],red:[1,2,3,4,0],expectedPlayers}),/gameAlreadyCommitted/);
});
test('all 120 player permutations resolve globally without duplicate identities',()=>{
  for(const order of permutations([0,1,2,3,4])){
    const result=solvePlayerSlots(order.map(i=>ids[i]),ids)!;
    assert.deepEqual(result.order,order);assert.equal(result.automatic,true);
  }
});
test('multi-pass OCR candidates use roster-match confidence without being capped by raw OCR confidence',()=>{
  const candidates=[
    [{text:'Pixel',confidence:.92,variant:'soft'},{text:'Pixel8',confidence:.31,variant:'threshold190'}],
    [{text:'Raven-X',confidence:.42,variant:'soft'}],
    [{text:'Aster_7',confidence:.28,variant:'threshold170'}],
    [{text:'Zero0',confidence:.20,variant:'threshold190'}],
    [{text:'K1ng',confidence:.18,variant:'soft'}],
  ];
  const players=['Pixel8','Raven-X','Aster_7','Zero0','K1ng'];
  const result=solvePlayerSlotCandidates(candidates,players)!;
  assert.deepEqual(result.order,[0,1,2,3,4]);
  assert.deepEqual(result.confidence,[1,1,1,1,1]);
  assert.equal(result.automatic,true);
  assert.equal(result.ocrConfidence?.[0],.31);
  assert.equal(result.ocrText?.[0],'Pixel8');
});

test('case, whitespace, NFKC and OCR confusion normalize; close IDs and substitutes never auto apply',()=>{
  assert.equal(solvePlayerSlots([' ＡＬＰＨＡ ','b r a v o','CHARLIE','Delta','Echo'],ids)!.automatic,true);
  assert.equal(solvePlayerSlots(['AOpha','Bravo','Charlie','Delta','Echo'],ids)!.automatic,false);
  const similar=['Den1','Denl','Charlie','Delta','Echo'];
  assert.equal(solvePlayerSlots(['DenI','Denl','Charlie','Delta','Echo'],similar)!.automatic,false);
  assert.equal(solvePlayerSlots(['Unknown','Bravo','Charlie','Delta','Echo'],ids)!.automatic,false);
  assert.equal(solvePlayerSlots(ids,ids,[.1,1,1,1,1])!.automatic,false);
  assert.equal(solvePlayerSlots(ids,ids,[1,1,1,1,1])!.automatic,true);
  assert.equal(solvePlayerSlots(['Alpha Roaming','Bravo Jungling','Charlie Mid','Delta Clash','Echo Farm'],ids)!.automatic,true);
  assert.equal(solvePlayerSlots(ids,['','','','','']),undefined);
});
test('mapping controls player/portrait/role, saves history, follows identity in Player BP and resets next game',()=>{
  const s=new Store(), base=initialState();
  base.blueTeam.players=[...ids];base.redTeam.players=ids.map(p=>'Red'+p);base.blueTeam.playerPortraits=ids.map(p=>'/'+p+'.png');base.draftRuleMode='player';
  apply(s,{type:'settings',settings:base});
  apply(s,{type:'set_player_slot_order',side:'blue',order:[4,3,2,1,0],expectedPlayers:ids});
  assert.equal(playerAtSlot(s.data.state,'blue',0).id,'Echo');
  assert.equal(playerAtSlot(s.data.state,'blue',0).portrait,'/Echo.png');
  assert.equal(playerAtSlot(s.data.state,'blue',0).role,'roam');
  assert.deepEqual(s.data.state.blueTeam.players,ids);
  phases('match').forEach((phase,i)=>apply(s,{type:'draft_action',...phase,heroId:heroes[i].id}));
  const echoHero=s.data.state.blueAssignments[0]!;
  apply(s,{type:'commit_game'});
  assert.deepEqual(s.data.state.draftHistory[0].bluePlayerSlotOrder,[4,3,2,1,0]);
  assert.throws(()=>apply(s,{type:'set_player_slot_order',side:'blue',order:[0,1,2,3,4],expectedPlayers:ids}));
  apply(s,{type:'score',team:'blue',delta:1});apply(s,{type:'next_game'});
  assert.deepEqual(s.data.state.bluePlayerSlotOrder,[0,1,2,3,4]);
  assert.equal(pickRestriction(s.data.state,'blue',4,echoHero),'usedByPlayer');
  assert.equal(pickRestriction(s.data.state,'blue',0,echoHero),undefined);
  apply(s,{type:'set_player_slot_order',side:'blue',order:[4,0,1,2,3],expectedPlayers:ids});
  assert.equal(pickRestriction(s.data.state,'blue',0,echoHero),'usedByPlayer');
  apply(s,{type:'undo'});assert.deepEqual(s.data.state.bluePlayerSlotOrder,[0,1,2,3,4]);
});
test('invalid permutations and stale rosters are atomic; legacy state upgrades; preset ID crops roundtrip',()=>{
  const s=new Store();
  for(const order of [[0,0,1,2,3],[0,1,2,3,5],[0,1,2,3]]){
    assert.throws(()=>apply(s,{type:'set_player_slot_order',side:'blue',order,expectedPlayers:s.data.state.blueTeam.players}));
    assert.equal(s.data.revision,0);
  }
  assert.throws(()=>apply(s,{type:'set_player_slot_order',side:'blue',order:[4,3,2,1,0],expectedPlayers:ids}));
  const state=initialState();delete (state as Partial<typeof state>).bluePlayerSlotOrder;
  assert.deepEqual(normalizeState(state).bluePlayerSlotOrder,[0,1,2,3,4]);
  const slots={...defaultCaptureSlots,playerIds:{blue1:{x:.1,y:.2,width:.2,height:.03}}};
  const preset=createCaptureSlotPreset({id:'test',name:'Test',slots});
  assert.deepEqual(readCaptureSlotPresets(JSON.stringify([preset]))[0].slots.playerIds,slots.playerIds);
  const legacy={...preset,playerIdLayoutVersion:undefined};
  assert.equal(readCaptureSlotPresets(JSON.stringify([legacy]))[0].slots.playerIds,undefined);
});


test('player ID region presets save, load and update independently from BP slots',()=>{
  const regions={
    blue1:{x:.1,y:.2,width:.2,height:.04},
    blue2:{x:.1,y:.3,width:.2,height:.04},
    red1:{x:.7,y:.2,width:.2,height:.04},
  };
  const preset=createPlayerIdRegionPreset({id:'ids-1',name:'Arena 1600x900',regions,sourceWidth:1600,sourceHeight:900,now:10});
  const parsed=readPlayerIdRegionPresets(JSON.stringify([preset]));
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].name,'Arena 1600x900');
  assert.deepEqual(parsed[0].regions,regions);
  assert.equal(parsed[0].sourceWidth,1600);
  const updated=updatePlayerIdRegionPreset(parsed[0],{name:'Arena v2',regions:{...regions,blue1:{x:.11,y:.21,width:.19,height:.05}},now:20});
  assert.equal(updated.name,'Arena v2');
  assert.equal(updated.updatedAt,20);
  assert.deepEqual(updated.regions.blue1,{x:.11,y:.21,width:.19,height:.05});
  assert.deepEqual(defaultCaptureSlots.bluePick1,defaultCaptureSlots.bluePick1);
  assert.deepEqual(readPlayerIdRegionPresets('invalid'),[]);
});


test('near-identical broadcast placeholder IDs require distinguishing suffix before automatic assignment',()=>{
  const players=['Pemain 1','Pemain 2','Pemain 3','Pemain 4','Pemain 5'];
  const indistinguishable=Array.from({length:5},()=>[
    {text:'Pemain',confidence:.91,variant:'soft'},
    {text:'Pemain ?',confidence:.85,variant:'threshold170'},
  ]);
  const ambiguous=solvePlayerSlotCandidates(indistinguishable,players)!;
  assert.equal(ambiguous.automatic,false);
  assert.equal(ambiguous.anomalies.length,5);
  const exact=[3,1,4,0,2].map(i=>[{text:players[i],confidence:.90,variant:'soft'}]);
  const verified=solvePlayerSlotCandidates(exact,players)!;
  assert.deepEqual(verified.order,[3,1,4,0,2]);
  assert.equal(verified.automatic,true);
  const withLostDigit=exact.map(row=>[...row]);
  withLostDigit[2]=[{text:'Pemain',confidence:.96,variant:'soft'}];
  assert.equal(solvePlayerSlotCandidates(withLostDigit,players)!.automatic,false);
});
