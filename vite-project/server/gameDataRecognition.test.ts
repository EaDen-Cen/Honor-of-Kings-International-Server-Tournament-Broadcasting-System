import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PlayerRecognitionProvider } from './playerRecognition.js';
import { classifySettlementPage, decodeGameFrame, frameHasVisualContent, recognizeLiveHud, recognizeSettlement } from './gameDataRecognition.js';
import { parsePostGameNumber, type PostGameMetric, type PostGameReport } from '../src/shared/postGame.js';
import { settlementPages } from '../src/shared/gameCapture.js';

const fixture=JSON.parse(await readFile(new URL('./fixtures/game-data-screenshots.json',import.meta.url),'utf8')) as {
  pages:Array<{page:string;cells:Array<{row:number;metric:PostGameMetric;expected:number;image:string}>}>;
  tabs:string[];hud:string;recap:string;
};
test('actual active settlement tabs classify seven pages and reject blank screens',async()=>{
  for(let i=0;i<7;i++)assert.equal((await classifySettlementPage(Buffer.from(fixture.tabs[i],'base64'))).page,settlementPages[i]);
  const blank=await sharp({create:{width:1920,height:1080,channels:3,background:'#000'}}).png().toBuffer();
  assert.equal((await classifySettlementPage(blank)).page,null);
  assert.equal(await frameHasVisualContent(blank),false,'black capture must not be accepted');
  assert.equal(await frameHasVisualContent(Buffer.from(fixture.tabs[0],'base64')),true,'real screenshot must not be rejected');
  await assert.rejects(decodeGameFrame('data:image/png;base64,'+blank.toString('base64'),{x:0,y:0,width:1,height:.5}),/16:9/);
  await assert.rejects(decodeGameFrame('data:image/png;base64,'+blank.toString('base64'),{x:0,y:0,width:2,height:1}),/Invalid/);
  const bordered=await sharp(Buffer.from(fixture.tabs[0],'base64')).extend({top:40,bottom:0,left:0,right:0,background:'#202020'}).png().toBuffer();
  const normalized=await decodeGameFrame('data:image/png;base64,'+bordered.toString('base64'),{x:0,y:40/1120,width:1,height:1080/1120});
  assert.equal((await classifySettlementPage(normalized)).page,'overview');
});

test('actual game digits preserve decimals, zeros, 100 percent, K units and recap counts',async()=>{
  const provider=new PlayerRecognitionProvider();
  try{
    await provider.prepare();assert.equal(provider.status,'ready',provider.error);
    let correct=0,reliable=0,total=0;
    for(const page of fixture.pages){
      const result=await provider.recognizeNumbers(page.cells.map(c=>c.image),true);
      page.cells.forEach((cell,index)=>{
        total++;const value=parsePostGameNumber(result.texts[index],cell.metric);
        if(value===cell.expected)correct++;
        if(result.confidences[index]>=.85){reliable++;assert.equal(value,cell.expected,`${page.page} row ${cell.row} ${cell.metric}: ${result.texts[index]}`);}
      });
    }
    assert.equal(total,320);assert.ok(correct>=310,`${correct}/${total} parsed correctly`);assert.ok(reliable>=300,`${reliable}/${total} reliable fields`);
    const hud=await recognizeLiveHud(Buffer.from(fixture.hud,'base64'),provider);
    assert.deepEqual(hud.candidates.map(c=>c.value),[0,0,1500,1500,0,0,12]);
    assert.ok(hud.candidates.every(c=>c.confidence>=.85));
    const recap=await recognizeSettlement(Buffer.from(fixture.recap,'base64'),'auto',{players:[]} as unknown as PostGameReport,provider);
    assert.equal(recap.page,'recap');
    assert.deepEqual(recap.teamCandidates?.map(c=>c.value),[20,4,29,38600,6,1,1,0,0,0,4,20,9,28000,0,0,0,0,0,0]);
    // Numeric whitelist and segmentation must not leak into the ID worker.
    const image='data:image/png;base64,'+(await sharp(Buffer.from('<svg width="240" height="60"><rect width="240" height="60" fill="white"/><text x="10" y="42" font-family="Arial" font-size="34">Alpha</text></svg>')).png().toBuffer()).toString('base64');
    const [textRead,numericRead]=await Promise.all([provider.recognize(Array(10).fill(image)),provider.recognizeNumbers(fixture.pages[0].cells.slice(0,10).map(cell=>cell.image),true)]);
    assert.ok(textRead.texts.every(text=>text==='Alpha'));assert.equal(numericRead.texts.length,10);
  }finally{await provider.close();}
});

test('page rows merge by confirmed identities rather than assuming BP order',async()=>{
  const players=Array.from({length:10},(_,index)=>({rowId:`row-${index}`,playerId:`Player${index}`,side:index<5?'blue':'red'}));
  const order=[4,0,2,3,1,8,7,6,9,5];let ambiguous=false;
  const provider={
    recognizePlayerIds:async()=>({texts:order.map(i=>players[i].playerId),confidences:Array(10).fill(1),elapsedMs:0,candidates:order.map(i=>[{text:ambiguous?'':players[i].playerId,confidence:1,variant:'soft' as const}])}),
    recognizeNumbers:async(images:string[])=>({texts:images.map(()=> '1'),confidences:images.map(()=>1),elapsedMs:0}),
  };
  const frame=Buffer.from(fixture.tabs[0],'base64'),report={players} as PostGameReport;
  const result=await recognizeSettlement(frame,'overview',report,provider);
  assert.deepEqual(result.rows.map(row=>row.rowId),order.map(i=>players[i].rowId));
  ambiguous=true;
  const uncertain=await recognizeSettlement(frame,'overview',report,provider);
  assert.ok(uncertain.rows.every(row=>row.rowId===null),'ambiguous ID evidence stays unbound for manual review');
});
