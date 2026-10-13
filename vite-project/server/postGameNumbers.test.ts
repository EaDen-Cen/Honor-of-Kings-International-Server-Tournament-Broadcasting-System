import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostGameNumber, canMergePostGameField, type PostGameField } from '../src/shared/postGame.js';

test('post-game units normalize without guessing ambiguous OCR',()=>{
  for(const [text,metric,expected] of [
    ['37.3K','gold',37300],['３７．３ｋ','totalDamage',37300],['1.25万','damageTaken',12500],
    ['12,345','healing',12345],[' 42.5％ ','participation',42.5],['9.8','rating',9.8],['0','kills',0],
    ['101%','damageShare',null],['3K','kills',null],['12%','gold',null],['1,2','gold',null],
    ['3 7','gold',null],['O.5','rating',null],['1.2','kills',null],['-1','deaths',null],
  ] as const)assert.equal(parsePostGameNumber(text,metric),expected,`${metric}: ${text}`);
});

test('repeated pages cannot degrade or replace trusted fields; manual corrections win',()=>{
  const current:PostGameField={value:20,confidence:.9,manual:false,sourcePage:'damage'};
  assert.equal(canMergePostGameField(current,{...current,confidence:.4}),false);
  assert.equal(canMergePostGameField(current,{...current,value:80,confidence:.99}),false);
  assert.equal(canMergePostGameField(current,{...current,confidence:.99}),true);
  assert.equal(canMergePostGameField({...current,confidence:.4},{...current,value:80}),true);
  assert.equal(canMergePostGameField({...current,manual:true},{...current,confidence:1}),false);
  assert.equal(canMergePostGameField(current,{...current,value:80,manual:true}),true);
});
