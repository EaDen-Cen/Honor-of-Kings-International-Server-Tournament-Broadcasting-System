import test from 'node:test';
import assert from 'node:assert/strict';
import { postGameCaptureRowIds } from './postGameCaptureRows.js';
const rows=Array.from({length:10},(_,i)=>'row-'+i);
test('single cropped player and arbitrary row subsets preserve explicit identities',()=>{
  assert.deepEqual(postGameCaptureRowIds(rows,['row-7'],['img']),['row-7']);
  assert.deepEqual(postGameCaptureRowIds(rows,['row-9','row-1'],['a','b']),['row-9','row-1']);
  assert.deepEqual(postGameCaptureRowIds(rows,undefined,Array(10).fill('img')),rows);
});
test('partial captures never silently map to first report rows',()=>{
  assert.throws(()=>postGameCaptureRowIds(rows,undefined,['image']),/rowIds required/);
  assert.throws(()=>postGameCaptureRowIds(rows,['row-1','row-1'],['a','b']),/duplicate/);
  assert.throws(()=>postGameCaptureRowIds(rows,['row-22'],['a']),/Invalid/);
  assert.throws(()=>postGameCaptureRowIds(rows,['row-2'],['a','b']),/Invalid/);
  assert.throws(()=>postGameCaptureRowIds(rows,[],[]),/1–10/);
});
