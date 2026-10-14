import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettlementIdentityMapping } from '../src/shared/settlementIdentity.js';
test('settlement row identities are reused across different pages',()=>{
  const overview=Array.from({length:10},(_,screenRow)=>({screenRow,rowId:'player-'+screenRow}));
  const mapped=mergeSettlementIdentityMapping({},overview);
  assert.equal(mapped['3'],'player-3');
  const damage=overview.map((row)=>({...row,rowId:row.screenRow===3?'wrong-player':null}));
  assert.deepEqual(mergeSettlementIdentityMapping(mapped,damage),mapped);
  const manual={...mapped,'3':'manual-correction'};
  assert.equal(mergeSettlementIdentityMapping(manual,overview)['3'],'manual-correction');
});
test('unknown OCR identity never clears a verified row',()=>{
  assert.deepEqual(mergeSettlementIdentityMapping({'0':'A'},[{screenRow:0,rowId:null},{screenRow:1,rowId:'B'}]),{'0':'A','1':'B'});
});
