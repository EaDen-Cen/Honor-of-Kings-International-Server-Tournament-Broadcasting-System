import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostGameNumber, postGameNumberResolution, formatPostGameValue, canMergePostGameField, type PostGameField } from '../src/shared/postGame.js';

test('post-game units normalize without guessing ambiguous OCR',()=>{
  for(const [text,metric,expected] of [
    ['37.3K','gold',37300],['３７．３ｋ','totalDamage',37300],['1.25万','damageTaken',12500],
    ['12,345','healing',12345],[' 42.5％ ','participation',42.5],['9.8','rating',9.8],['0','kills',0],
    ['101%','damageShare',null],['3K','kills',null],['12%','gold',null],['1,2','gold',null],
    ['3 7','gold',null],['O.5','rating',null],['1.2','kills',null],['-1','deaths',null],
  ] as const)assert.equal(parsePostGameNumber(text,metric),expected,`${metric}: ${text}`);
});

test('exact economy refines rounded totals, never the reverse; shares and ratios stay distinct',()=>{
  const rounded:PostGameField={value:7600,resolution:postGameNumberResolution('7.6k','gold'),confidence:.96,manual:false,sourcePage:'economy'};
  const exact:PostGameField={value:7589,resolution:1,confidence:.91,manual:false,sourcePage:'summary'};
  assert.equal(canMergePostGameField(rounded,exact),true);
  assert.equal(canMergePostGameField(exact,rounded),false);
  assert.equal(canMergePostGameField(rounded,{...exact,value:7600}),true,'same-value exact read should also refine precision');
  assert.equal(canMergePostGameField({...exact,value:7600},exact),false,'two different exact totals remain a real conflict');
  assert.equal(canMergePostGameField(rounded,{...exact,value:7463}),false);
  assert.equal(canMergePostGameField({...rounded,manual:true},exact),false);
  assert.equal(postGameNumberResolution('1.25万','gold'),100);
  assert.equal(formatPostGameValue(18,'goldShare'),'18%');
  assert.equal(formatPostGameValue(.8,'damageConversion'),'0.8 ×');
  assert.equal(parsePostGameNumber('B','rating'),null);
  assert.equal(parsePostGameNumber('18%','damageConversion'),null);
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
