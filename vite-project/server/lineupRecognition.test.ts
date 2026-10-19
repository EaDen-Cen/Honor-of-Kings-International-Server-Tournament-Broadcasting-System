import test from 'node:test';
import assert from 'node:assert/strict';
import { solveLineupTeam, planTrustedLineupUpdate, type SlotResult } from '../src/control/lineupRecognition.js';

const picks=[11,22,33,44,55];
function slots(order:number[],primary=.95,secondary=.1):SlotResult[]{
  return order.map((heroId,playerIndex)=>({side:'blue',playerIndex,preview:'',candidates:picks.map(id=>({heroId:id,confidence:id===heroId?primary:secondary}))}));
}

test('final lineup recognition preserves the uniquely detected player-slot order',()=>{
  const order=[33,55,11,44,22];
  const solution=solveLineupTeam(slots(order),picks);
  assert.deepEqual(solution?.heroes,order);
  assert.equal(solution?.minimum,.95);
});

test('even repeated high confidence does not resolve tied or near-tied hero assignments',()=>{
  assert.equal(solveLineupTeam(slots(picks,.95,.95),picks),undefined);
  const ambiguous=slots(picks);
  ambiguous[0].candidates.find(candidate=>candidate.heroId===22)!.confidence=.94;
  ambiguous[1].candidates.find(candidate=>candidate.heroId===11)!.confidence=.94;
  assert.equal(solveLineupTeam(ambiguous,picks),undefined);
});

test('incomplete, duplicate and invalid-confidence lineups cannot be applied',()=>{
  assert.equal(solveLineupTeam(slots(picks).slice(1),picks),undefined);
  assert.equal(solveLineupTeam(slots(picks),[11,11,33,44,55]),undefined);
  const invalid=slots(picks);
  invalid[0].candidates=invalid[0].candidates.map(candidate=>({...candidate,confidence:NaN}));
  assert.equal(solveLineupTeam(invalid,picks),undefined);
});

test('a trusted blue-side hero swap applies even when red OCR is unresolved',()=>{
  const blue=solveLineupTeam(slots([22,11,33,44,55]),picks);
  const plan=planTrustedLineupUpdate(blue,undefined,picks,[66,77,88,99,111]);
  assert.deepEqual(plan?.blue,[22,11,33,44,55]);
  assert.deepEqual(plan?.red,[66,77,88,99,111]);
  assert.equal(plan?.changedBlue,true);
  assert.equal(plan?.changedRed,false);
  assert.equal(plan?.trustedRed,false);
});

test('a low confidence proposal never alters even one hero',()=>{
  const low=solveLineupTeam(slots([22,11,33,44,55],.45,.1),picks);
  const plan=planTrustedLineupUpdate(low,undefined,picks,[66,77,88,99,111]);
  assert.deepEqual(plan?.blue,picks);
  assert.equal(plan?.changedBlue,false);
});

test('two trustworthy teams may update independently and incomplete authoritative lineups are not submitted',()=>{
  const blue=solveLineupTeam(slots([22,11,33,44,55]),picks);
  const other=[66,77,88,99,111];
  const red=solveLineupTeam(slots([77,66,88,99,111]),other);
  const plan=planTrustedLineupUpdate(blue,red,picks,other);
  assert.deepEqual(plan?.red,[77,66,88,99,111]);
  assert.equal(plan?.changedRed,true);
  assert.equal(planTrustedLineupUpdate(blue,red,picks,[null,77,88,99,111]),undefined);
});
