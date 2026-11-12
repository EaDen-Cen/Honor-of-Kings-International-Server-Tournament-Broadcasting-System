import test from 'node:test';
import assert from 'node:assert/strict';
import { solveLineupTeam, planTrustedLineupUpdate, observeLineup, lineupPlaybackFrame, type SlotResult } from '../src/control/lineupRecognition.js';

const picks=[11,22,33,44,55];

test('rechecking a frozen lineup or dropping a decoded frame cannot confirm a swap', () => {
  const initial = { signature: '', count: 0 };
  const firstFrame = lineupPlaybackFrame({ totalVideoFrames: 32, droppedVideoFrames: 2 });
  const first = observeLineup(initial, 'swap', firstFrame);
  assert.equal(first.count, 1);
  assert.equal(observeLineup(first, 'swap', firstFrame).count, 1);
  assert.equal(observeLineup(first, 'swap', lineupPlaybackFrame({ totalVideoFrames: 33, droppedVideoFrames: 3 })).count, 1);
  assert.equal(observeLineup(first, 'swap', 31).count, 2);
  assert.equal(observeLineup(first, 'different swap', 31).count, 1);
  assert.equal(observeLineup(first, 'swap', 1).count, 1);
  assert.equal(observeLineup(initial, 'swap', 31).count, 1);
});

test('two automatic scans without a verifiable video frame never confirm a swap', () => {
  assert.equal(lineupPlaybackFrame(undefined), undefined);
  assert.equal(lineupPlaybackFrame({ totalVideoFrames: 0, droppedVideoFrames: 0 }), undefined);
  const first = observeLineup({ signature: '', count: 0 }, 'swap', undefined);
  assert.equal(observeLineup(first, 'swap', undefined).count, 1);
  const identified = observeLineup(first, 'swap', 10);
  assert.equal(identified.count, 1);
  assert.equal(observeLineup(identified, 'swap', undefined).count, 1);
});
function slots(order:number[],primary=.95,secondary=.1,pool=picks):SlotResult[]{
  return order.map((heroId,playerIndex)=>({side:'blue',playerIndex,preview:'',candidates:pool.map(id=>({heroId:id,confidence:id===heroId?primary:secondary}))}));
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
  const red=solveLineupTeam(slots([77,66,88,99,111],.95,.1,other),other);
  const plan=planTrustedLineupUpdate(blue,red,picks,other);
  assert.deepEqual(plan?.red,[77,66,88,99,111]);
  assert.equal(plan?.changedRed,true);
  assert.equal(planTrustedLineupUpdate(blue,red,picks,[null,77,88,99,111]),undefined);
});
