import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingDiskSpace } from './recordingStorage.js';

test('recording disk checks actual available blocks and warns on low GiB or low percent', async () => {
  const giB=1024n**3n;
  const path='E:\\OBS Recordings';
  let readPath='';
  const sufficient=await recordingDiskSpace(path,async directory=>{
    readPath=directory;
    return {bsize:giB,blocks:300n,bavail:90n};
  });
  assert.equal(readPath,path);
  assert.equal(sufficient.freeBytes,90*1024**3);
  assert.equal(sufficient.freePercent,30);
  assert.equal(sufficient.low,false);
  const lowBytes=await recordingDiskSpace(path,async()=>({bsize:giB,blocks:300n,bavail:15n}));
  assert.equal(lowBytes.low,true);
  const lowPercent=await recordingDiskSpace(path,async()=>({bsize:giB,blocks:500n,bavail:30n}));
  assert.equal(lowPercent.low,true);
});

test('recording disk cannot silently substitute app drive when OBS path is unknown', async () => {
  await assert.rejects(recordingDiskSpace('',async()=>({bsize:1n,blocks:5n,bavail:3n})));
  await assert.rejects(recordingDiskSpace('E:',async()=>({bsize:0n,blocks:0n,bavail:0n})));
});
