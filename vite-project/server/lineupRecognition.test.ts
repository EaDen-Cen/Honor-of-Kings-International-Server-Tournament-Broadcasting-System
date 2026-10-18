import test from 'node:test';
import assert from 'node:assert/strict';
import { solveLineupTeam, type SlotResult } from '../src/control/lineupRecognition.js';

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
