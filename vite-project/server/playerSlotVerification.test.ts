import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeVerification} from '../src/shared/playerSlotVerification.js';
import type {PlayerSlotSolution} from '../src/shared/playerSlots.js';

test('repeating an ambiguous ID result never clears recognition anomalies',()=>{
  const ambiguous:PlayerSlotSolution={order:[3,1,4,0,2],confidence:[.96,.96,.96,.96,.96],average:.96,margin:.1,automatic:false,anomalies:[0,2]};
  let evidence;
  for(let frame=0;frame<5;frame++){
    const result=mergeVerification(evidence,ambiguous);
    evidence=result.evidence;
    assert.equal(result.solution?.automatic,false);
    assert.deepEqual(result.solution?.anomalies,[0,2]);
  }
});

test('clean evidence still requires two consistent frames and adequate margin',()=>{
  const clean:PlayerSlotSolution={order:[0,1,2,3,4],confidence:[.91,.91,.91,.91,.91],average:.91,margin:.1,automatic:false,anomalies:[]};
  const first=mergeVerification(undefined,clean);
  assert.equal(first.solution?.automatic,false);
  assert.equal(mergeVerification(first.evidence,clean).solution?.automatic,true);
  assert.equal(mergeVerification(first.evidence,{...clean,margin:.02}).solution?.automatic,false);
});
