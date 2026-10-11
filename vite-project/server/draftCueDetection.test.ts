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
    assert.equal(await detectDraftLockCue(frame,true),'none',`Ban ${hero.englishName}`);
    for(const background of ['#17598b','#9e294c']) {
      const game=await sharp(source).resize(72,72).extend({bottom:22,background}).png().toBuffer();
      assert.equal(await detectDraftLockCue(game),'none',`${hero.englishName} ${background}`);
      assert.equal(await detectDraftLockCue(game,true),'none',`Ban ${hero.englishName} ${background}`);
    }
  }
});



test('blurred Ban locks touching pale artwork retain positive evidence',async()=>{
  const svg=Buffer.from(`<svg width="64" height="64">
    <rect width="64" height="64" fill="#102a47"/>
    <ellipse cx="24" cy="30" rx="20" ry="24" fill="#d6d8e1"/>
    <ellipse cx="37" cy="39" rx="5" ry="6" fill="#486a8a"/>
    <path d="M 30 44 V 39 A 7 7 0 0 1 44 39 V 44" stroke="#b5d3ed" stroke-width="4" fill="none"/>
    <rect x="27" y="43" width="20" height="13" rx="3" fill="#f4f8ff"/>
    <rect x="35" y="46" width="4" height="7" rx="1" fill="#8c9eae"/>
  </svg>`);
  for(const size of [54,64,80]) {
    const frame=await sharp(svg).resize(size,size).blur(.4).jpeg({quality:70}).toBuffer();
    assert.equal(await detectDraftLockCue(frame,true),'padlock',`blended ${size}`);
    const noHole=Buffer.from(svg.toString().replace('fill="#8c9eae"','fill="#f4f8ff"'));
    assert.equal(await detectDraftLockCue(await sharp(noHole).resize(size,size).png().toBuffer(),true),'none',`no keyhole ${size}`);
  }
});

test('compressed circular Ban artwork on either team background is not a padlock',async()=>{
  const mask=Buffer.from('<svg width="54" height="54"><circle cx="27" cy="27" r="26" fill="white"/></svg>');
  for(const hero of heroes) {
    const source=await readFile(new URL(`../public${hero.imageLink}`,import.meta.url));
    const {width=0,height=0}=await sharp(source).metadata();
    const side=Math.floor(Math.min(width,height)*.74);
    const portrait=await sharp(source).extract({left:Math.floor((width-side)/2),top:Math.floor((height-side)/2),width:side,height:side}).resize(54,54).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
    for(const background of ['#173b69','#5d2044']) {
      const frame=await sharp(portrait).flatten({background}).jpeg({quality:65}).toBuffer();
      assert.equal(await detectDraftLockCue(frame,true),'none',`${hero.englishName} ${background}`);
    }
  }
});
