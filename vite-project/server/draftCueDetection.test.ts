import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import heroes from '../src/components/HeroList.js';
import {detectDraftLockCue} from './draftCueDetection.js';

async function mark(kind:'checkmark'|'padlock',size=96,red=false) {
  const shape=kind==='checkmark'
    ? '<path d="M 5 10 L 11 16 L 22 5" stroke="white" stroke-width="4" fill="none"/>'
    : '<path d="M 5 12 V 7 A 7 7 0 0 1 19 7 V 12" stroke="white" stroke-width="4" fill="none"/><rect x="1" y="10" width="22" height="14" fill="white"/><path d="M 10 16 L 14 16 L 14 21 L 10 21 Z" fill="#172334"/>';
  return sharp(Buffer.from(`<svg width="96" height="96"><rect width="96" height="96" fill="#172334"/><path d="M 76 60 L 95 78 L 76 95 L 57 78 Z" fill="${red?'#9e294c':'#126caa'}"/><g transform="translate(63 69)">${shape}</g></svg>`)).resize(size,size).png().toBuffer();
}
test('positive bottom checkmark and padlock survive window scaling',async()=>{
  for(const kind of ['checkmark','padlock'] as const) for(const size of [48,72,96,160]) for(const red of [false,true]) {
    assert.equal(await detectDraftLockCue(await mark(kind,size,red)),kind,`${kind} ${size} ${red?'red':'blue'}`);
  }
});
test('unmarked roster portraits, brightness changes and white borders are not lock evidence',async()=>{
  for(const hero of heroes) {
    const source=await readFile(new URL(`../public${hero.imageLink}`,import.meta.url));
    const frame=await sharp(source).resize(72,72).modulate({brightness:1.1}).extend({top:2,bottom:2,left:2,right:2,background:'white'}).png().toBuffer();
    assert.equal(await detectDraftLockCue(frame),'none',hero.englishName);
    for(const background of ['#17598b','#9e294c']) {
      const game=await sharp(source).resize(72,72).extend({bottom:22,background}).png().toBuffer();
      assert.equal(await detectDraftLockCue(game),'none',`${hero.englishName} ${background}`);
    }
  }
});


