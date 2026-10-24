import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recognizeSettlement} from './gameDataRecognition.js';
import type {PostGameReport} from '../src/shared/postGame.js';
test('settlement starts separate OCR workers together, reuses identical identity crops and invalidates for roster changes',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/settlement-page-semantics.json',import.meta.url),'utf8'));
  const frame=Buffer.from(fixture.pages[0].image,'base64');
  const report={id:'cache-test',players:Array.from({length:10},(_,i)=>({rowId:`row-${i}`,playerId:`Player${i}`,side:i<5?'blue':'red'}))} as PostGameReport;
  let identities=0,numbers=0,release:()=>void=()=>{};
  const provider={
    recognizePlayerIds:async()=>{identities++;await new Promise<void>(resolve=>{release=resolve;});return {texts:report.players.map(p=>p.playerId),confidences:Array(10).fill(1),elapsedMs:1,candidates:report.players.map(p=>[{text:p.playerId,confidence:1,variant:'soft' as const}])};},
    recognizeNumbers:async(images:string[])=>{numbers++;release();return {texts:images.map(()=> '1'),confidences:images.map(()=>.96),elapsedMs:1};},
  };
  const first=await recognizeSettlement(frame,'summary',report,provider);
  const second=await recognizeSettlement(frame,'summary',report,provider);
  assert.equal(identities,1);assert.equal(numbers,2);assert.deepEqual(first.candidates,second.candidates);assert.equal(second.timings?.identityCacheHit,true);
  report.players[0].playerId='Changed';await recognizeSettlement(frame,'summary',report,provider);assert.equal(identities,2);
});
