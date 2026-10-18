import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadHeroAsset, detectImage } from './assets.js';

test('downloaded hero assets cannot overwrite decoupled legacy icon filenames',async()=>{
  const root=await mkdtemp(join(tmpdir(),'hok-assets-'));
  const originalFetch=globalThis.fetch;
  const bytes=new Uint8Array(await readFile(new URL('../../e2e/fixtures/player-test.png',import.meta.url)));
  globalThis.fetch=async()=>new Response(bytes);
  try {
    await mkdir(join(root,'heroesImg'));
    await writeFile(join(root,'heroesImg/120.png'),'existing hero 119 icon');
    const args={heroId:120,campId:777,sourceUrl:'https://camp.honorofkings.com/new.png',publicDir:root};
    const first=await downloadHeroAsset(args),again=await downloadHeroAsset(args);
    assert.match(first.localPath,/^\/heroesImg\/sync-777-[a-f0-9]{16}\.png$/);
    assert.equal(first.localPath,again.localPath,'unchanged content has a stable reusable asset path');
    assert.equal(await readFile(join(root,'heroesImg/120.png'),'utf8'),'existing hero 119 icon');
    assert.deepEqual(new Uint8Array(await readFile(join(root,first.localPath.slice(1)))),bytes);
    assert.equal((await readdir(join(root,'heroesImg'))).length,2);
    for(const sourceUrl of ['http://camp.honorofkings.com/x.png','https://evil.example/x.png','https://user:pass@camp.honorofkings.com/x.png'])await assert.rejects(()=>downloadHeroAsset({...args,sourceUrl}));
    await assert.rejects(()=>downloadHeroAsset({...args,heroId:NaN}),/identity/);
    globalThis.fetch=async()=>new Response(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    await assert.rejects(()=>downloadHeroAsset(args),/invalid hero image/,'a signature alone cannot pass as a decodable image');
    globalThis.fetch=async()=>new Response('large',{headers:{'content-length':String(8*1024*1024+1)}});
    await assert.rejects(()=>downloadHeroAsset(args),/unexpectedly large/);
  } finally {globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});}
});

test('chunked oversized assets are cancelled before buffering the entire response',async()=>{
  const originalFetch=globalThis.fetch;let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(new Uint8Array(8*1024*1024));controller.enqueue(new Uint8Array(1));},
    cancel(){cancelled=true;},
  });
  globalThis.fetch=async()=>new Response(stream);
  try {
    await assert.rejects(()=>downloadHeroAsset({heroId:120,campId:777,sourceUrl:'https://camp.honorofkings.com/large.png',publicDir:'unused'}),/unexpectedly large/);
    assert.equal(cancelled,true);
  } finally {globalThis.fetch=originalFetch;}
});

test('PNG-like text with an invalid trailing signature is rejected',()=>{
  assert.equal(detectImage(Uint8Array.from([0x89,0x50,0x4e,0x47,0,0,0,0])),undefined);
});
