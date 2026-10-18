import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifySettlementPage,recognizeSettlement} from './gameDataRecognition.js';
import {PlayerRecognitionProvider} from './playerRecognition.js';
import {parsePostGameNumber,postGameGrades,type PostGameMetric,type PostGameReport} from '../src/shared/postGame.js';
import {settlementPageMetrics} from '../src/shared/gameCapture.js';

const fixture=JSON.parse(await readFile(new URL('./fixtures/settlement-page-semantics.json',import.meta.url),'utf8')) as {
 pages:Array<{page:string;image:string}>;
 cells:Array<{page:string;row:number;metric:PostGameMetric;expected:number;image:string}>;
 grades:Array<{expected:string;image:string}>;
};
test('new eight actual pages include landing summary and keep economy and rating semantics separate',async()=>{
  for(const page of fixture.pages)assert.equal((await classifySettlementPage(Buffer.from(page.image,'base64'))).page,page.page);
  assert.deepEqual(settlementPageMetrics('summary'),['kills','deaths','assists','gold']);
  assert.ok(!settlementPageMetrics('summary').includes('rating'));
  assert.ok(settlementPageMetrics('overview').includes('goldShare'));
  assert.ok(settlementPageMetrics('damage').includes('damageConversion'));
});
test('actual new gold, shares, ratios and summary digits have no trusted misreads; stylized grades remain drafts when uncertain',async()=>{
  const provider=new PlayerRecognitionProvider();
  try{
    await provider.prepare();
    const result=await provider.recognizeNumbers(fixture.cells.map(cell=>cell.image),true);
    let correct=0,reliable=0;
    fixture.cells.forEach((cell,i)=>{
      const value=parsePostGameNumber(result.texts[i],cell.metric);
      if(value===cell.expected)correct++;
      if(result.confidences[i]>=.85){reliable++;assert.equal(value,cell.expected,`${cell.page} ${cell.row} ${cell.metric}`);}
    });
    assert.equal(fixture.cells.length,90);assert.ok(correct>=88,`${correct}/90 correct`);assert.ok(reliable>=85,`${reliable}/90 reliable`);
    const grades=await provider.recognizeGrades(fixture.grades.map(cell=>cell.image));
    fixture.grades.forEach((cell,i)=>{if(grades.confidences[i]>=.85&&postGameGrades.includes(grades.texts[i] as typeof postGameGrades[number]))assert.equal(grades.texts[i],cell.expected);});
    // Every call resets the alphabet: letter-grade OCR cannot contaminate digits.
    const next=await provider.recognizeNumbers(fixture.cells.slice(0,4).map(cell=>cell.image),true);
    assert.deepEqual(next.texts.map((text,i)=>parsePostGameNumber(text,fixture.cells[i].metric)),[4,6,3,7589]);
  }finally{await provider.close();}
});
test('summary endpoint reads its four numeric columns and returns letter grades separately from ratings',async()=>{
  const players=Array.from({length:10},(_,i)=>({rowId:`row-${i}`,playerId:`Player${i}`,side:i<5?'blue':'red'}));
  const provider={
    recognizePlayerIds:async()=>({texts:players.map(p=>p.playerId),confidences:Array(10).fill(1),elapsedMs:0,candidates:players.map(p=>[{text:p.playerId,confidence:1,variant:'soft' as const}])}),
    recognizeNumbers:async(images:string[])=>({texts:images.map((_,i)=>String(fixture.cells[i].expected)),confidences:images.map(()=>.96),elapsedMs:0}),
    recognizeGrades:async()=>({texts:fixture.grades.map(c=>c.expected),confidences:Array(10).fill(.94),elapsedMs:0}),
  };
  const result=await recognizeSettlement(Buffer.from(fixture.pages[0].image,'base64'),'auto',{players} as PostGameReport,provider);
  assert.equal(result.page,'summary');assert.equal(result.candidates.length,40);
  assert.deepEqual(result.candidates.slice(0,4).map(c=>c.value),[4,6,3,7589]);
  assert.equal(result.grades?.[0].value,'B');assert.ok(result.candidates.every(c=>c.metric!=='rating'));
});
test('an unavailable optional grade worker preserves completed summary numeric and identity drafts',async()=>{
  const players=Array.from({length:10},(_,i)=>({rowId:`row-${i}`,playerId:`Player${i}`,side:i<5?'blue':'red'}));
  const provider={
    recognizePlayerIds:async()=>({texts:players.map(p=>p.playerId),confidences:Array(10).fill(1),elapsedMs:0,candidates:players.map(p=>[{text:p.playerId,confidence:1,variant:'soft' as const}])}),
    recognizeNumbers:async(images:string[])=>({texts:images.map((_,i)=>String(fixture.cells[i].expected)),confidences:images.map(()=>.96),elapsedMs:0}),
    recognizeGrades:async()=>{throw new Error('Numeric OCR is busy');},
  };
  const result=await recognizeSettlement(Buffer.from(fixture.pages[0].image,'base64'),'summary',{players} as PostGameReport,provider);
  assert.equal(result.candidates.length,40);
  assert.deepEqual(result.candidates.slice(0,4).map(c=>c.value),[4,6,3,7589]);
  assert.deepEqual(result.rows.map(row=>row.rowId),players.map(p=>p.rowId));
  assert.equal(result.grades,undefined,'failed OCR never fabricates a grade');
  assert.match(result.gradeWarning??'',/KDA and gold retained/);
});
