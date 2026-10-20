import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettlementIdentityMapping,defaultSettlementIdentityMapping } from '../src/shared/settlementIdentity.js';
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

test('default settlement identity maps blue P1–P5 and red P1–P5 to matching authoritative slots',()=>{
  const players=[...Array.from({length:5},(_,slot)=>({rowId:'blue-'+slot,side:'blue' as const,slot})),
    ...Array.from({length:5},(_,slot)=>({rowId:'red-'+slot,side:'red' as const,slot}))];
  const normal=defaultSettlementIdentityMapping(players,'blue');
  assert.deepEqual(Object.values(normal),players.map(p=>p.rowId));
  const reversed=defaultSettlementIdentityMapping(players,'red');
  assert.equal(reversed['0'],'red-0');
  assert.equal(reversed['4'],'red-4');
  assert.equal(reversed['5'],'blue-0');
  assert.equal(reversed['9'],'blue-4');
  const correction=defaultSettlementIdentityMapping(players,'blue',{'0':'blue-1'});
  assert.equal(correction['0'],'blue-1');
  assert.equal(correction['1'],undefined); // Requires explicit review, not duplicate binding.
  assert.equal(correction['5'],'red-0');
  assert.deepEqual(defaultSettlementIdentityMapping(players,'blue',{'0':'red-0'}),normal);
});
