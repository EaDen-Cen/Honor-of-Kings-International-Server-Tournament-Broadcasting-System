import test from 'node:test';
import assert from 'node:assert/strict';
import { phases,initialState,type MatchState } from '../src/shared/types.js';
import { normalizeState } from '../src/shared/draftRules.js';
import { cnHeroes,heroesForPool,heroAllowed } from '../src/shared/heroPool.js';
import { cnHeroCatalog } from '../src/data/cnHeroCatalog.js';
import { simulatorSlotForPhase,simulatorBanVisualKeys,simulatorSlotsForTurn } from '../src/simulator/bpSimulatorModel.js';
import { captureTargetForPhaseIndex,defaultCaptureSlots } from '../src/control/bpCaptureLayout.js';
import { Store } from './store.js';
const apply=(store:Store,action:Parameters<Store['apply']>[2])=>store.apply('pool-'+Math.random().toString(36).slice(2,15),store.data.revision,action);
test('0–5 bans each produce ten picks and two symmetric sides',()=>{
  for(const mode of ['normal','match'] as const)for(const firstPickSide of ['blue','red'] as const)for(const count of [0,1,2,3,4,5] as const){
    const sequence=phases(mode,firstPickSide,count);
    assert.equal(sequence.length,10+2*count);
    for(const team of ['blue','red'] as const){
      assert.equal(sequence.filter(p=>p.team===team&&p.action==='pick').length,5);
      assert.equal(sequence.filter(p=>p.team===team&&p.action==='ban').length,count);
    }
    if(!count)assert.equal(sequence[0].action,'pick');
    if(mode==='match'&&count===5){
      assert.deepEqual(sequence.slice(0,4).map(p=>p.action),'ban ban ban ban'.split(' '));
      assert.deepEqual(sequence.slice(10,16).map(p=>p.action),'ban ban ban ban ban ban'.split(' '));
    }
    if(mode==='normal'&&count>0)assert.ok(sequence.slice(0,2*count).every(p=>p.action==='ban'));
  }
});
test('5-ban simulator mirrors red slots and capture can target Ban #5',()=>{
  const sequence=phases('match','blue',5),lastBlue=sequence.findLastIndex(p=>p.team==='blue'&&p.action==='ban'),lastRed=sequence.findLastIndex(p=>p.team==='red'&&p.action==='ban');
  assert.equal(simulatorSlotForPhase('match','blue',lastBlue,5)?.slotIndex,4);
  assert.equal(simulatorSlotForPhase('match','blue',lastRed,5)?.slotIndex,4);
  assert.deepEqual(simulatorBanVisualKeys('red',5),['redBan5','redBan4','redBan3','redBan2','redBan1']);
  const state={draftMode:'match' as const,firstPickSide:'blue' as const,banCount:5 as const};
  assert.equal(captureTargetForPhaseIndex(state,defaultCaptureSlots,lastBlue)?.key,'blueBan5');
  assert.equal(simulatorSlotsForTurn('match','blue',lastBlue,5)[0].slotIndex,4);
});
test('legacy mode defaults remain 4-Ban Match, 2-Ban Normal',()=>{
  assert.equal(normalizeState({...initialState(),heroPool:undefined as unknown as MatchState['heroPool'],banCount:undefined as unknown as MatchState['banCount']}).banCount,4);
  assert.equal(normalizeState({...initialState(),draftMode:'normal',banCount:undefined as unknown as MatchState['banCount']}).banCount,2);
  assert.equal(phases('match').length,18);assert.equal(phases('normal').length,14);
});
test('CN-only heroes have namespaced IDs and cannot be selected in global mode',()=>{
  assert.equal(cnHeroes.length,cnHeroCatalog.entries.length,'CN pool must not silently include international-only heroes');
  const globals=heroesForPool('global'),cnOnly=cnHeroes.find(hero=>!globals.some(global=>global.id===hero.id));
  assert.ok(cnOnly,'CN roster must contain distinct CN-only entries');
  assert.ok(cnOnly!.id>=20000);
  assert.ok(heroAllowed('cn',cnOnly!.id));
  assert.equal(heroAllowed('global',cnOnly!.id),false);
});
test('server accepts per-side ban settings, rejects changes during draft, commits separate CN-only IDs',()=>{
  for(const banCount of [0,1,2,3,4,5] as const){
    const s=new Store(),settings={...initialState(),banCount,heroPool:'cn' as const};
    apply(s,{type:'settings',settings});
    const pool=heroesForPool('cn'),used=new Set<number>();
    for(const phase of phases('match','blue',banCount)){
      if(phase.action==='ban')apply(s,{type:'skip_ban',team:phase.team});
      else{
        const hero=pool.find(h=>!used.has(h.id))!;
        used.add(hero.id);apply(s,{type:'draft_action',...phase,heroId:hero.id});
      }
      if(s.data.state.currentPhase===1)assert.throws(()=>apply(s,{type:'settings',settings:{...settings,banCount:((banCount+1)%6) as typeof banCount}}),/rulesLocked/);
    }
    assert.equal(s.data.state.draftComplete,true);assert.equal(s.data.state.blueBans.length,banCount);
    assert.equal(s.data.state.redBans.length,banCount);
    apply(s,{type:'commit_game'});
    assert.equal(s.data.state.draftHistory[0].banCount,banCount);
    assert.equal(s.data.state.draftHistory[0].heroPool,'cn');
  }
});
test('global mode rejects CN-only hero and invalid bans are rejected',()=>{
  const s=new Store(),onlyCn=cnHeroes.find(h=>!heroAllowed('global',h.id))!;
  assert.throws(()=>apply(s,{type:'draft_action',team:'blue',action:'ban',heroId:onlyCn.id}),/heroNotInPool/);
  assert.throws(()=>apply(s,{type:'settings',settings:{...initialState(),banCount:6 as MatchState['banCount']}}),/Invalid hero pool or bans/);
});

test('CN untrained auto-accept is forcibly disabled on settings and restored snapshots',()=>{
  const s=new Store();
  apply(s,{type:'settings',settings:{...initialState(),heroPool:'cn',recognitionAutoAccept:true}});
  assert.equal(s.data.state.recognitionAutoAccept,false);
  assert.equal(normalizeState({...s.data.state,recognitionAutoAccept:true}).recognitionAutoAccept,false);
  apply(s,{type:'settings',settings:{...s.data.state,heroPool:'global',recognitionAutoAccept:true}});
  assert.equal(s.data.state.recognitionAutoAccept,true);
});
