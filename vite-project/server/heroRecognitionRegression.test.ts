import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import heroes from '../src/components/HeroList.js';
import {recognizeImage,recognizeClientFrame} from './capture.js';

// Zoom, tint, compression and an overlaid Ban lock are absent from the clean
// self-template test. Exercise each reported hero and its mistaken counterpart.
test('zoomed compressed Ban portraits retain identity with lock artwork excluded',async()=>{
  const names=['海月','东皇太一','弗洛伦','云樱','影','敖隐','艾琳','拉普拉普','暃'];
  for(const hero of heroes.filter(h=>names.includes(h.chineseName))) {
    const source=await readFile(new URL(`../public${hero.imageLink}`,import.meta.url));
    const {width=0,height=0}=await sharp(source).metadata();
    const side=Math.floor(Math.min(width,height)*.74);
    const zoom=await sharp(source).extract({left:Math.floor((width-side)/2),top:Math.floor((height-side)/2),width:side,height:side}).resize(64,64).modulate({brightness:.75}).png().toBuffer();
    const cue=Buffer.from('<svg width="64" height="64"><path d="M 44 46 V 41 A 6 6 0 0 1 56 41 V 46" stroke="white" stroke-width="3" fill="none"/><rect x="40" y="45" width="20" height="16" fill="white"/><rect x="48" y="50" width="4" height="7" fill="#172334"/></svg>');
    const frame=await sharp(zoom).composite([{input:cue}]).jpeg({quality:55}).toBuffer();
    const matches=await recognizeImage(frame,undefined,'circle');
    assert.equal(matches[0].heroId,hero.id,hero.englishName);
    assert.ok(matches[0].confidence>=.65,`${hero.englishName}: ${matches[0].confidence}`);
  }
});

test('private annotated real-game crops reproduce identity and lock evidence', {skip:!process.env.HOK_HERO_RECOGNITION_SAMPLE},async()=>{
  const fixture=JSON.parse(await readFile(process.env.HOK_HERO_RECOGNITION_SAMPLE!,'utf8')) as {samples:Array<{image:string;lockImage?:string;shape?:'square'|'circle';expectedHeroId?:number;expectedCue?:string}>};
  let assertions=0;
  for(const sample of fixture.samples) {
    const evidence=await recognizeClientFrame(sample.image,undefined,sample.shape,sample.lockImage);
    if(sample.expectedHeroId!==undefined) {assert.equal(evidence.candidates[0]?.heroId,sample.expectedHeroId);assertions++;}
    if(sample.expectedCue!==undefined) {assert.equal(evidence.lockCue,sample.expectedCue);assertions++;}
  }
  assert.ok(assertions>0,'Annotate expectedHeroId and/or expectedCue before running this private regression.');
});
