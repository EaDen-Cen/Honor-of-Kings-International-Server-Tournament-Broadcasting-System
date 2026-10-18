import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {PlayerRecognitionProvider} from './playerRecognition.js';
import {recognizeSettlementGoldCurve} from './settlementGoldCurve.js';
import {recognizeSettlement} from './gameDataRecognition.js';
import type {PostGameReport} from '../src/shared/postGame.js';
import {reportGoldDifference,validGoldDifferenceTimeline} from '../src/shared/postGameTimeline.js';
async function frame(name:string){return sharp({create:{width:1920,height:1080,channels:3,background:'#142d59'}}).composite([{input:await readFile(new URL(`./fixtures/economy-curve-${name}.png`,import.meta.url)),left:160,top:575}]).png().toBuffer();}
test('real recap markers and axis OCR recover signed economy curves including lead reversals',async()=>{
  const provider=new PlayerRecognitionProvider();
  try{
    await provider.prepare();
    const positive=await recognizeSettlementGoldCurve(await frame('positive'),provider);
    assert.equal(positive.error,undefined);assert.equal(positive.points.length,11);assert.equal(positive.maxDifference,10700);assert.ok(positive.confidence>=.85);
    assert.deepEqual(positive.points[0],{timeSeconds:0,difference:0});assert.equal(positive.points.at(-1)?.timeSeconds,660);assert.ok(Math.abs(positive.points.at(-1)!.difference-10700)<=120,'pixel estimates stay within the axis glyph/line width');assert.ok(positive.points.every(p=>p.difference>=0));
    const crossing=await recognizeSettlementGoldCurve(await frame('crossing'),provider);
    assert.equal(crossing.error,undefined);assert.equal(crossing.points.length,16);assert.equal(crossing.maxDifference,800);assert.equal(crossing.points.at(-1)?.timeSeconds,797);
    assert.ok(Math.abs(crossing.points.find(p=>p.timeSeconds===240)!.difference-800)<=20);assert.ok(crossing.points.some(p=>p.difference<0));assert.ok(crossing.points.some(p=>p.difference>0));
    assert.ok(validGoldDifferenceTimeline({...crossing,source:'settlement'}));
    const compressed=await recognizeSettlementGoldCurve(await sharp(await frame('crossing')).jpeg({quality:94}).png().toBuffer(),provider);
    assert.equal(compressed.error,undefined);assert.equal(compressed.points.length,16);assert.equal(compressed.points.at(-1)?.timeSeconds,797);assert.ok(compressed.confidence>=.85);
  }finally{await provider.close();}
});
test('missing chart or inconsistent axis labels produce no publishable economy points',async()=>{
  const blank=await sharp({create:{width:1920,height:1080,channels:3,background:'#142d59'}}).png().toBuffer();
  let calls=0;const provider={recognizeNumbers:async(images:string[])=>{calls++;return {texts:images.map((_,i)=>i===0?'+0.8k':'+1.2k'),confidences:images.map(()=>.99),elapsedMs:0};}};
  assert.equal((await recognizeSettlementGoldCurve(blank,provider)).points.length,0);assert.equal(calls,0);
  assert.match((await recognizeSettlementGoldCurve(await frame('crossing'),provider)).error??'',/scales/);
});
test('matching scales require two reliable reads and expose the weaker confidence',async()=>{
  for(const confidence of [.2,.84,.9]){
    let calls=0;
    const provider={recognizeNumbers:async(images:string[])=>{
      calls++;
      return calls===1||confidence<.85&&calls<=3
        ? {texts:images.map(()=>'+10.7k'),confidences:images.map((_,i)=>calls<=2&&i===0?.99:confidence),elapsedMs:0}
        : {texts:['00:00','04:00','11:00'],confidences:images.map(()=>.99),elapsedMs:0};
    }};
    const result=await recognizeSettlementGoldCurve(await frame('positive'),provider);
    if(confidence<.85){
      assert.equal(result.points.length,0,'one reliable axis cannot promote a weak counterpart');
      assert.match(result.error??'',/high-confidence/);
      assert.equal(calls,3,'unreadable axes exhaust only their bounded retries, not clock OCR');
    }else{
      assert.equal(result.points.length,11);
      assert.equal(result.confidence,confidence,'curve confidence reflects its weakest required axis');
    }
  }
});
test('valid native scale OCR can recover an invalid higher-confidence masked string',async()=>{
  let calls=0;
  const provider={recognizeNumbers:async(images:string[])=>{
    calls++;
    if(calls===1)return {texts:['garbled','+10.7k'],confidences:[.99,.98],elapsedMs:0};
    if(calls===2)return {texts:['+10.7k','+10.7k'],confidences:[.94,.96],elapsedMs:0};
    return {texts:['00:00','04:00','11:00'],confidences:images.map(()=>.99),elapsedMs:0};
  }};
  const result=await recognizeSettlementGoldCurve(await frame('positive'),provider);
  assert.equal(result.error,undefined);assert.equal(result.points.length,11);
  assert.equal(result.maxDifference,10700);assert.equal(result.confidence,.94);
});
test('actual operator captures adapt to content zoom/pan, resampling and an obscured final marker',async()=>{
  const provider=new PlayerRecognitionProvider();
  try{
    await provider.prepare();
    const zoomed=await recognizeSettlementGoldCurve(await readFile(new URL('./fixtures/economy-curve-zoomed.png',import.meta.url)),provider);
    assert.equal(zoomed.error,undefined);assert.equal(zoomed.points.length,10);assert.equal(zoomed.maxDifference,10700);assert.ok(zoomed.confidence>=.85);assert.match(zoomed.warning??'',/obscured/);
    assert.equal(zoomed.points[0].timeSeconds,0);assert.equal(zoomed.points.at(-1)?.timeSeconds,590,'do not fabricate the cursor-covered 11:00 point');
    assert.equal(zoomed.durationSeconds,660,'preserve the observed final clock beyond the last visible marker');
    const resampled=await recognizeSettlementGoldCurve(await readFile(new URL('./fixtures/economy-curve-resampled.png',import.meta.url)),provider);
    assert.equal(resampled.error,undefined);assert.equal(resampled.points.length,11);assert.equal(resampled.maxDifference,10700);assert.equal(resampled.points.at(-1)?.timeSeconds,660);assert.ok(resampled.confidence>=.85);
    const transformed=await sharp(await frame('crossing')).extract({left:110,top:70,width:1760,height:990}).resize(1920,1080).png().toBuffer();
    const shifted=await recognizeSettlementGoldCurve(transformed,provider);
    assert.equal(shifted.error,undefined);assert.equal(shifted.points.length,16);assert.equal(shifted.maxDifference,800);assert.equal(shifted.points.at(-1)?.timeSeconds,797);assert.ok(shifted.points.some(p=>p.difference<0));
  }finally{await provider.close();}
});
test('old manual replay totals display their difference without inventing cumulative totals for screenshot curves',()=>{
  assert.deepEqual(reportGoldDifference({goldTimeline:[{timeSeconds:0,blueGold:1500,redGold:1500},{timeSeconds:120,blueGold:3100,redGold:3500}]}),[{timeSeconds:0,difference:0},{timeSeconds:120,difference:-400}]);
  assert.equal(validGoldDifferenceTimeline({source:'settlement',confidence:.8,maxDifference:800,points:[{timeSeconds:0,difference:0},{timeSeconds:60,difference:400}]}),false);
  assert.equal(validGoldDifferenceTimeline({source:'settlement',confidence:.95,maxDifference:800,points:[{timeSeconds:0,difference:0},{timeSeconds:60,difference:900}]}),false);
});
test('a busy curve worker preserves already recognized recap data rather than failing the entire page',async()=>{
  let calls=0;
  const provider={recognizePlayerIds:async()=>{throw new Error('IDs are not needed on recap');},recognizeNumbers:async(images:string[])=>{
    if(calls++)throw new Error('Numeric OCR is busy');
    return {texts:images.map((_,i)=>i%8===0?'20/4/29':'1'),confidences:images.map(()=>.96),elapsedMs:0};
  }};
  const result=await recognizeSettlement(await frame('positive'),'recap',{players:[]} as unknown as PostGameReport,provider);
  assert.equal(result.teamCandidates?.length,20);assert.equal(result.teamCandidates?.[0].value,20);assert.equal(result.goldCurve?.confidence,0);assert.match(result.goldCurve?.error??'',/retry/);
});
