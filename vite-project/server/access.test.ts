import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessStore, validateAccessData } from './access.js';

test('malformed role credentials and partial password hashes fail before serving access',()=>{
  const tokens={control:'control-value',caster:'caster-value',overlay:'overlay-value'};
  for(const value of [null,{}, {tokens:{control:'control-value'}},{tokens:{...tokens,caster:tokens.control}},{tokens,passwordHash:'0'.repeat(64)},{tokens,salt:'0'.repeat(32)},{tokens,passwordHash:'',salt:''},{tokens,passwordHash:'0'.repeat(63),salt:'0'.repeat(32)}])assert.throws(()=>validateAccessData(value),/Invalid access data/);
  validateAccessData({tokens});
  validateAccessData({tokens,passwordHash:'0'.repeat(64),salt:'0'.repeat(32)});
  const root=mkdtempSync(join(tmpdir(),'hok-access-invalid-')),file=join(root,'access.json');
  try {writeFileSync(file,JSON.stringify({tokens,passwordHash:'broken',salt:'broken'}));assert.throws(()=>new AccessStore(file),/Invalid access data/);}
  finally {rmSync(root,{recursive:true,force:true});}
});

test('failed credential rotation keeps previously acknowledged credentials and file',()=>{
  const root=mkdtempSync(join(tmpdir(),'hok-access-atomic-')),file=join(root,'access.json');
  try {
    const access=new AccessStore(file),token=access.token('control'),before=readFileSync(file,'utf8');
    mkdirSync(file+'.tmp');assert.throws(()=>access.setPassword('a-new-password'));
    assert.equal(access.token('control'),token);assert.equal(access.role(token),'control');
    assert.equal(access.configured,false);assert.equal(readFileSync(file,'utf8'),before);
  } finally {rmSync(root,{recursive:true,force:true});}
});
