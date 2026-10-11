import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PlayerRecognitionProvider } from './playerRecognition.js';
import { normalizePlayerText, solvePlayerSlotCandidates } from '../src/shared/playerSlots.js';
import { readFileSync } from 'node:fs';
test('resident offline OCR batches ten names and ten numeric fields without model downloads',async()=>{
  const provider=new PlayerRecognitionProvider();
  try{
    await provider.prepare();assert.equal(provider.status,'ready',provider.error);
    const render=async(text:string)=>'data:image/png;base64,'+(await sharp(Buffer.from(`<svg width="420" height="60"><rect width="100%" height="100%" fill="white"/><text x="16" y="42" font-family="DejaVu Sans" font-size="36" fill="black">${text}</text></svg>`)).png().toBuffer()).toString('base64');
    const names=['Alpha','Bravo','Charlie','Delta','Echo','Fox','Golf','Hotel','India','Juliet'];
    const first=await provider.recognize(await Promise.all(names.map(render)));assert.deepEqual(first.texts,names);
    const values=['8','2','10','12.5','35','14000','72000','0','99','100'];
    const second=await provider.recognize(await Promise.all(values.map(render)));assert.deepEqual(second.texts,values);
    const renderDark=async(text:string)=>'data:image/png;base64,'+(await sharp(Buffer.from(`<svg width="420" height="60"><rect width="100%" height="100%" fill="#081522"/><text x="16" y="42" font-family="DejaVu Sans" font-size="36" font-weight="700" fill="white">${text}</text></svg>`)).png().toBuffer()).toString('base64');
    const dark=await provider.recognize(await Promise.all(names.map(renderDark)));assert.deepEqual(dark.texts,names);
    const renderEsports=async(text:string)=>'data:image/png;base64,'+(await sharp(Buffer.from(`<svg width="420" height="60"><rect width="100%" height="100%" fill="#16486f"/><rect x="8" y="6" width="180" height="48" rx="4" fill="#153d5c"/><text x="18" y="42" font-family="DejaVu Sans" font-size="34" font-weight="700" fill="#c9d2dd">${text}</text></svg>`)).png().toBuffer()).toString('base64');
    const esportsNames=['Pixel8','Raven-X','Aster_7','Zero0','K1ng','Orbit_1','Echo-0','Light8','Nova0','Alpha7'];
    const esports=await provider.recognizePlayerIds(await Promise.all(esportsNames.map(renderEsports)));
    assert.ok(esports.candidates.every(row=>row.length>0));
    const blue=solvePlayerSlotCandidates(esports.candidates.slice(0,5),esportsNames.slice(0,5))!;
    const red=solvePlayerSlotCandidates(esports.candidates.slice(5),esportsNames.slice(5))!;
    assert.deepEqual(blue.order,[0,1,2,3,4]);
    assert.deepEqual(red.order,[0,1,2,3,4]);
    assert.ok(blue.average>=.9);
    assert.ok(red.average>=.9);
    await assert.rejects(provider.recognize(['data:image/png;base64,AAAA']),/Ten small/);
    assert.equal(provider.status,'ready');
  }finally{await provider.close();}
});

test('wide dim right-aligned ID strips retain ink and real Chinese screenshot text',async()=>{
  const provider=new PlayerRecognitionProvider(undefined,'chi_sim+eng');
  try{
    await provider.prepare();assert.equal(provider.status,'ready',provider.error);
    const fixture=JSON.parse(readFileSync(new URL('./fixtures/player-id-dim-strip.json',import.meta.url),'utf8'));
    const screenshot=await provider.recognizePlayerIds(Array(10).fill(fixture.image));
    assert.ok(screenshot.candidates.every(row=>row.some(candidate=>candidate.text.replace(/\s/g,'')==='听雨')));
    const whiteElm=JSON.parse(readFileSync(new URL('./fixtures/player-id-white-elm.json',import.meta.url),'utf8'));
    const chinese=await provider.recognizePlayerIds(Array(10).fill(whiteElm.image));
    assert.ok(chinese.candidates.every(row=>row.some(candidate=>candidate.text.replace(/\s/g,'')==='白榆')));
    const novaFixture=JSON.parse(readFileSync(new URL('./fixtures/player-id-nova-zero.json',import.meta.url),'utf8'));
    const nova=await provider.recognizePlayerIds(Array(10).fill(novaFixture.image));
    assert.ok(nova.candidates.every(row=>row.some(candidate=>candidate.text.replace(/\s/g,'')==='Nova0')));
    const trickyRoster=['Nova0','0cean','Iline','Ocean0','B8ta'];
    const trickyImages=await Promise.all(trickyRoster.map(async(text,index)=>index===0?novaFixture.image:
      'data:image/png;base64,'+(await sharp(Buffer.from(`<svg width="420" height="60"><rect width="100%" height="100%" fill="#182030"/><text x="16" y="42" font-family="DejaVu Sans" font-size="36" font-weight="700" fill="white">${text}</text></svg>`)).png().toBuffer()).toString('base64')));
    const tricky=await provider.recognizePlayerIds([...trickyImages,...trickyImages],[trickyRoster,trickyRoster]);
    for(const offset of [0,5]){
      const solution=solvePlayerSlotCandidates(tricky.candidates.slice(offset,offset+5),trickyRoster)!;
      assert.deepEqual(solution.order,[0,1,2,3,4]);
      if(normalizePlayerText(solution.ocrText?.[1]??'')!==normalizePlayerText(trickyRoster[1])){
        // O/0 remains ambiguous next to Ocean0: a roster permutation is not proof.
        assert.equal(solution.automatic,false,JSON.stringify(solution));
        assert.ok(solution.anomalies.includes(1));
      }else{
        assert.equal(solution.automatic,true,JSON.stringify(solution));
      }
    }
    const numbers=['8','2','10','12.5','35','14000','72000','0','99','100'];
    const numeric=await Promise.all(numbers.map(async(text)=>'data:image/png;base64,'+(await sharp(Buffer.from(`<svg width="420" height="60"><rect width="100%" height="100%" fill="white"/><text x="16" y="42" font-family="DejaVu Sans" font-size="36" fill="black">${text}</text></svg>`)).png().toBuffer()).toString('base64')));
    assert.deepEqual((await provider.recognize(numeric)).texts,numbers);
    const names=['Alpha','Bravo','Charlie','Delta','Echo','Fox','Golf','Hotel','India','Juliet'];
    const order=[3,0,4,1,2];
    const ids=[...order.map(index=>names[index]),...order.map(index=>names[index+5])];
    const images=await Promise.all(ids.map(async(text,index)=>{
      const svg=`<svg width="570" height="90"><defs><linearGradient id="bg"><stop stop-color="#202334"/><stop offset="1" stop-color="#58192e"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><text x="${index<5?18:550}" y="53" text-anchor="${index<5?'start':'end'}" font-family="DejaVu Sans" font-size="20" font-weight="700" fill="#88818b">${text}</text></svg>`;
      return 'data:image/png;base64,'+(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
    }));
    const result=await provider.recognizePlayerIds(images,[names.slice(0,5),names.slice(5)]);
    assert.ok(result.candidates.every(row=>row.length>0&&row.every(candidate=>candidate.variant==='soft')),'confident first pass skips threshold retries');
    for(const offset of [0,5]){
      const solution=solvePlayerSlotCandidates(result.candidates.slice(offset,offset+5),names.slice(offset,offset+5))!;
      assert.deepEqual(solution.order,order);
      assert.equal(solution.automatic,true,JSON.stringify(solution));
    }
    const blank='data:image/png;base64,'+(await sharp({create:{width:570,height:90,channels:3,background:'#182030'}}).png().toBuffer()).toString('base64');
    const empty=await provider.recognizePlayerIds(Array(10).fill(blank));
    assert.equal(solvePlayerSlotCandidates(empty.candidates.slice(0,5),names.slice(0,5))!.automatic,false);
  }finally{await provider.close();}
});

test('gold ID text is isolated from flags and hero background without moving calibrated bounds',async()=>{
  const provider=new PlayerRecognitionProvider(undefined,'chi_sim+eng');
  try{
    await provider.prepare();assert.equal(provider.status,'ready',provider.error);
    const fixture=JSON.parse(readFileSync(new URL('./fixtures/player-id-gold-background.json',import.meta.url),'utf8'));
    const result=await provider.recognizePlayerIds(Array(10).fill(fixture.image));
    assert.ok(result.candidates.every(row=>row.some(candidate=>candidate.variant==='yellow'&&candidate.text.replace(/\s/g,'')==='DMT.Tamirana')),JSON.stringify(result.candidates));
  }finally{await provider.close();}
});
