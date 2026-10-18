import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualNumber } from '../src/control/manualNumber.js';

test('manual stats accept complete bounded numbers and retain invalid drafts instead of submitting partial data',()=>{
  const counter={min:0,max:999,integer:true};
  assert.deepEqual(parseManualNumber(' 123 ',counter),{valid:true,value:123});
  assert.deepEqual(parseManualNumber('0',counter),{valid:true,value:0});
  for(const draft of ['', ' ', '-', '.', 'NaN', 'Infinity', '0x10', '2e2'])assert.equal(parseManualNumber(draft,counter).valid,false,draft);
  for(const draft of ['-1','1000','1.5'])assert.equal(parseManualNumber(draft,counter).valid,false,draft);
  assert.deepEqual(parseManualNumber('99.9',{min:0,max:100}),{valid:true,value:99.9});
  assert.equal(parseManualNumber('100.1',{min:0,max:100}).valid,false);
});

test('only optional HUD fields can be cleared to unknown, while actual zero remains zero',()=>{
  const optional={min:0,max:1000000,integer:true,allowEmpty:true};
  assert.deepEqual(parseManualNumber('',optional),{valid:true,value:undefined});
  assert.deepEqual(parseManualNumber('0',optional),{valid:true,value:0});
  assert.equal(parseManualNumber('-',{...optional}).valid,false);
  assert.equal(parseManualNumber('',{...optional,allowEmpty:false}).valid,false);
  assert.equal(parseManualNumber('7201',{...optional,max:7200}).valid,false);
});
