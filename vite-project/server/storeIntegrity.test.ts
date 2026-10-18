import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';

test('malformed persistence envelopes and unordered delayed events are rejected before use',()=>{
  let now=1000;const store=new Store(undefined,()=>now);
  store.apply(randomUUID(),0,{type:'settings',settings:{...store.data.state,stage:'One'}});
  now=2000;store.apply(randomUUID(),1,{type:'settings',settings:{...store.data.state,stage:'Two'}});
  const root=mkdtempSync(join(tmpdir(),'hok-integrity-')),file=join(root,'match.json');
  try {
    writeFileSync(file,JSON.stringify(store.data));assert.deepEqual(new Store(file).data,store.data);
    const mutations:Array<(data:Store['data'])=>void>=[
      data=>{data.revision=-1;},data=>{data.delay=3601;},data=>{data.ids=['duplicate-id','duplicate-id'];},
      data=>{data.events[1].timestamp=500;},data=>{data.events[1].revision=1;},
      data=>{data.events[1].revision=3;},data=>{data.events[1].id='bad';},
    ];
    for(const mutate of mutations){const data=structuredClone(store.data);mutate(data);writeFileSync(file,JSON.stringify(data));assert.throws(()=>new Store(file),/比赛存档/);}
    writeFileSync(file,'null');assert.throws(()=>new Store(file),/比赛存档/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('team logos follow the same URL rules as player portraits and invalid updates are atomic',()=>{
  const store=new Store(),before=structuredClone(store.data);
  for(const logo of ['https://','https://name:password@example.com/a.png','/\\example.com/a.png','https://example.com/bad image.png','/bad\nimage.png']){
    assert.throws(()=>store.apply(randomUUID(),store.data.revision,{type:'settings',settings:{...store.data.state,blueTeam:{...store.data.state.blueTeam,logo}}}));
    assert.deepEqual(store.data,before);
  }
  store.apply(randomUUID(),0,{type:'settings',settings:{...store.data.state,blueTeam:{...store.data.state.blueTeam,logo:'https://example.com/logo.png'}}});
  assert.equal(store.data.state.blueTeam.logo,'https://example.com/logo.png');
});
