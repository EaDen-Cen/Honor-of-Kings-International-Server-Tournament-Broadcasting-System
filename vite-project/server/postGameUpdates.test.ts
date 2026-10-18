import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPostGameFieldUpdate } from '../src/control/postGameUpdates.js';
import type { PostGameField } from '../src/shared/postGame.js';

test('reapplying OCR cannot create no-op history or overwrite trusted conflicts',()=>{
  const stored:PostGameField={value:73300,sourcePage:'overview',confidence:.95,manual:false};
  assert.equal(hasPostGameFieldUpdate(stored,{...stored,capturedAt:2000,evidence:'/new.png'}),false);
  assert.equal(hasPostGameFieldUpdate(stored,{...stored,value:87300,confidence:.99}),false);
  assert.equal(hasPostGameFieldUpdate({...stored,manual:true},{...stored,confidence:1}),false);
  assert.equal(hasPostGameFieldUpdate(undefined,stored),true);
  assert.equal(hasPostGameFieldUpdate({...stored,confidence:.6},{...stored,value:87300}),true);
  assert.equal(hasPostGameFieldUpdate(stored,{...stored,confidence:.99}),true);
  assert.equal(hasPostGameFieldUpdate(stored,{...stored,manual:true}),true);
});
