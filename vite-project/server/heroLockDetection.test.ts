import test from 'node:test';
import assert from 'node:assert/strict';
import {freshHeroLockStability,updateHeroLockStability} from '../src/control/heroLockDetection.js';

test('Pick needs its own persistent checkmark, including when already locked on first scan',()=>{
  const input={phaseKey:'1:4',heroId:12,candidateReady:true,action:'pick',lockCue:'checkmark'} as const;
  const first=updateHeroLockStability(freshHeroLockStability(),input);
  assert.equal(first.locked,false);
  assert.equal(updateHeroLockStability(first.stability,input).locked,true);
  for(const lockCue of ['none','padlock',undefined] as const) {
    assert.equal(updateHeroLockStability(first.stability,{...input,lockCue}).stability.count,0);
  }
});
test('Ban requires a padlock; a tick, changing portrait or unknown hero cannot lock',()=>{
  const input={phaseKey:'1:0',heroId:12,candidateReady:true,action:'ban',lockCue:'padlock'} as const;
  const first=updateHeroLockStability(freshHeroLockStability(),input);
  assert.equal(updateHeroLockStability(first.stability,input).locked,true);
  for(const change of [{lockCue:'none' as const},{lockCue:'checkmark' as const},{candidateReady:false},{heroId:27},{phaseKey:'1:1'}]) {
    assert.equal(updateHeroLockStability(first.stability,{...input,...change}).locked,false);
  }
});
test('double Pick slots must each confirm; the next slot cannot substitute for either',()=>{
  const ready={phaseKey:'1:5',candidateReady:true,action:'pick',lockCue:'checkmark'} as const;
  const first=updateHeroLockStability(freshHeroLockStability(),{...ready,heroId:12});
  const a=updateHeroLockStability(first.stability,{...ready,heroId:12});
  const b=updateHeroLockStability(freshHeroLockStability(),{...ready,heroId:27,lockCue:'none'});
  assert.equal(a.locked&&b.locked,false);
});
