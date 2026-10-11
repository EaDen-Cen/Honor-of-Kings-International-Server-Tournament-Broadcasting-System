import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, phases } from '../src/shared/types.js';
import { completedSimulatorSlots, migrateLegacySimulatorSlotHeroes, simulatorBanVisualKeys, simulatorControlSync, simulatorNextTurnPhase, simulatorPlayerOrdersMatch, simulatorPlayerTestRoster, simulatorPreviousTurnPhase, simulatorPreselectSwitchMoments, simulatorRandomDelayMs, simulatorRandomPlayerOrder, simulatorSlotForPhase, simulatorSlotKey, simulatorSlotsForTurn, swapSimulatorPickHeroes } from '../src/simulator/bpSimulatorModel.js';

test('simulator match mode follows the production 18-phase HOK draft order', () => {
  const sequence=phases('match','blue');
  assert.equal(sequence.length,18);
  const keys=sequence.map((_,index)=>simulatorSlotKey(simulatorSlotForPhase('match','blue',index)!));
  assert.deepEqual(keys,[
    'blueBan1','redBan1','blueBan2','redBan2',
    'bluePick1','redPick1','redPick2','bluePick2','bluePick3','redPick3',
    'redBan3','blueBan3','redBan4','blueBan4',
    'redPick4','bluePick4','bluePick5','redPick5',
  ]);
});

test('simulator mirrors team ownership when red has first pick', () => {
  assert.equal(simulatorSlotKey(simulatorSlotForPhase('match','red',0)!),'redBan1');
  assert.equal(simulatorSlotKey(simulatorSlotForPhase('match','red',4)!),'redPick1');
  assert.equal(simulatorSlotKey(simulatorSlotForPhase('match','red',17)!),'bluePick5');
});

test('normal mode exposes only the production normal-mode slots', () => {
  const sequence=phases('normal','blue');
  const slots=completedSimulatorSlots('normal','blue',sequence.length);
  assert.equal(slots.length,sequence.length);
  assert.equal(slots.filter(slot=>slot.action==='pick').length,10);
  assert.equal(slots.filter(slot=>slot.action==='ban').length,4);
  assert.equal(slots.some(slot=>slot.action==='ban'&&slot.slotIndex>1),false);
});


test('ban slots are axis-mirrored on the red side',()=>{
  assert.deepEqual(simulatorBanVisualKeys('blue'),['blueBan1','blueBan2','blueBan3','blueBan4']);
  assert.deepEqual(simulatorBanVisualKeys('red'),['redBan4','redBan3','redBan2','redBan1']);
});

test('player hero swap exchanges pick portraits without touching other slots',()=>{
  const before={
    bluePick1:11,
    bluePick2:22,
    bluePick3:33,
    redPick1:44,
  };
  const after=swapSimulatorPickHeroes(before,'blue',0,2);
  assert.equal(after.bluePick1,33);
  assert.equal(after.bluePick3,11);
  assert.equal(after.bluePick2,22);
  assert.equal(after.redPick1,44);
});


test('simulator exposes simultaneous HOK pick turns instead of serial single picks',()=>{
  assert.deepEqual(
    simulatorSlotsForTurn('match','blue',5).map(simulatorSlotKey),
    ['redPick1','redPick2'],
  );
  assert.equal(simulatorNextTurnPhase('match','blue',5),7);
  assert.deepEqual(
    simulatorSlotsForTurn('match','blue',7).map(simulatorSlotKey),
    ['bluePick2','bluePick3'],
  );
  assert.equal(simulatorNextTurnPhase('match','blue',7),9);
  assert.deepEqual(
    simulatorSlotsForTurn('match','blue',15).map(simulatorSlotKey),
    ['bluePick4','bluePick5'],
  );
  assert.equal(simulatorPreviousTurnPhase('match','blue',7),5);
});


test('simulator random autoplay delay stays inside the configured range',()=>{
  assert.equal(simulatorRandomDelayMs(900,1800,()=>0),900);
  assert.equal(simulatorRandomDelayMs(900,1800,()=>1),1800);
  assert.equal(simulatorRandomDelayMs(900,1800,()=>.5),1350);
  assert.equal(simulatorRandomDelayMs(1800,900,()=>0),900);
});

test('autoplay preselect switches leave a stable quiet window before lock',()=>{
  const values=[0,.5,1,.25,.75];
  let cursor=0;
  const moments=simulatorPreselectSwitchMoments(3000,()=>values[cursor++%values.length]);
  assert.ok(moments.length>=1);
  assert.ok(moments.every((value,index)=>value>=400&&(index===0||value>moments[index-1])));
  assert.ok(moments.at(-1)!<=1800);
  assert.deepEqual(simulatorPreselectSwitchMoments(900,()=>0),[]);
});


test('player-order simulator shuffles only inside each five-player team',()=>{
  const values=[.99,.1,.8,.2,.7,.3,.6,.4,.5,.05];
  let cursor=0;
  const order=simulatorRandomPlayerOrder(()=>values[cursor++%values.length]);
  assert.equal(order.length,5);
  assert.deepEqual([...order].sort(),[0,1,2,3,4]);
  assert.equal(order.every((value,index)=>value===index),false);
});

test('player-order simulator creates ten unique multilingual IDs without crossing team pools',()=>{
  const roster=simulatorPlayerTestRoster('mixed',()=>.42);
  assert.equal(roster.blue.length,5);
  assert.equal(roster.red.length,5);
  assert.equal(new Set([...roster.blue,...roster.red]).size,10);
  assert.equal(roster.blue.some(id=>roster.red.includes(id)),false);
});

test('player-order comparison requires the exact P1-P5 permutation',()=>{
  assert.equal(simulatorPlayerOrdersMatch([2,0,4,1,3],[2,0,4,1,3]),true);
  assert.equal(simulatorPlayerOrdersMatch([2,0,4,3,1],[2,0,4,1,3]),false);
});


test('simulator can mirror Control draft history or final lineup without changing authoritative state',()=>{
  const state=initialState();
  state.draftMode='normal';
  state.firstPickSide='blue';
  state.blueBans=[11,22];
  state.redBans=[33,null];
  state.bluePicks=[41,42,43,44,45];
  state.redPicks=[51,52,53,54,55];
  state.blueAssignments=[43,42,41,44,45];
  state.redAssignments=[51,55,53,54,52];
  state.currentPhase=phases('normal','blue').length;
  state.draftComplete=true;
  state.blueTeam.players=['B1','B2','B3','B4','B5'];
  state.redTeam.players=['R1','R2','R3','R4','R5'];
  state.bluePlayerSlotOrder=[2,0,1,4,3];
  state.redPlayerSlotOrder=[1,0,4,3,2];

  const bp=simulatorControlSync(state,{},false);
  assert.equal(bp.slotHeroes.bluePick1,41);
  assert.equal(bp.slotHeroes.bluePick3,43);
  assert.equal(bp.slotHeroes.redPick2,52);
  assert.equal(bp.slotHeroes.blueBan1,11);
  assert.ok(bp.emptyBans.includes('redBan2'));
  assert.equal(bp.locked.length,phases('normal','blue').length);

  const lineup=simulatorControlSync(state,{},true);
  assert.deepEqual(
    [1,2,3,4,5].map(index=>lineup.slotHeroes[`bluePick${index}`]),
    state.blueAssignments,
  );
  assert.deepEqual(
    [1,2,3,4,5].map(index=>lineup.slotHeroes[`redPick${index}`]),
    state.redAssignments,
  );
  assert.deepEqual(lineup.bluePlayers,state.blueTeam.players);
  assert.deepEqual(lineup.bluePlayerOrder,state.bluePlayerSlotOrder);
});

test('simulator v2 local state hero IDs migrate to canonical release-order IDs once',()=>{
  assert.deepEqual(
    migrateLegacySimulatorSlotHeroes({
      bluePick1:1,
      bluePick2:54,
      redPick1:120,
      redBan1:85,
    }),
    {
      bluePick1:72,
      bluePick2:88,
      redPick1:119,
      redBan1:1,
    },
  );
});
