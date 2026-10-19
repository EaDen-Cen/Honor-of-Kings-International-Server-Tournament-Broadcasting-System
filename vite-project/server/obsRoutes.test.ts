import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ObsService} from './obs/ObsService.js';
import {createObsRoutes} from './obsRoutes.js';
import {Store} from './store.js';
import {archiveData} from './recovery.js';

async function fixture(){
  const root=mkdtempSync(join(tmpdir(),'hok-obs-http-')),configFile=join(root,'obs-connection.local.json');
  const service=new ObsService(configFile);
  const routes=createObsRoutes(service,token=>token==='director'?'control':token==='viewer'?'overlay':token==='caster'?'caster':undefined);
  const server=createServer(async(req,res)=>{if(!await routes(req,res,new URL(req.url||'/','http://localhost'))){res.writeHead(404);res.end();}});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  const request=async(path:string,method='GET',body?:unknown,token='director',headers:Record<string,string>={})=>{
    const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
    return {status:response.status,body:await response.json()};
  };
  return {root,configFile,service,request,close:async()=>{await service.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true});}};
}

test('OBS configuration, local paths and controls require director access even on localhost',async()=>{
  const f=await fixture();
  try{
    for(const token of ['','viewer','caster'])for(const [path,method] of [['/api/obs','GET'],['/api/obs/status','GET'],['/api/obs/config','GET'],['/api/obs/config','PUT'],['/api/obs/connect','POST'],['/api/obs/disconnect','POST'],['/api/obs/command','POST']]){
      const result=await f.request(path,method,method==='GET'?undefined:{password:'must-not-save'},token);
      assert.equal(result.status,token?403:401,`${token||'anonymous'} ${method} ${path}`);
      assert.equal('config' in result.body,false);assert.equal('recordHealth' in result.body,false);
    }
    assert.equal(existsSync(f.configFile),false,'denied writes must not create connection settings');
    for(const path of ['/api/obs','/api/obs/connect','/api/obs/config']){
      const result=await f.request(path,path.endsWith('connect')?'POST':'GET',undefined,'director',{Origin:'https://untrusted.invalid'});
      assert.equal(result.status,403);
    }
    assert.equal(f.service.getStatus().connection,'disconnected');
  }finally{await f.close();}
});

test('OBS password is write-only and excluded from full recovery and shareable match archives',async()=>{
  const f=await fixture(),password='fixture-obs-password-never-return';
  try{
    const saved=await f.request('/api/obs/config','PUT',{url:'ws://127.0.0.1:4455',password,enabled:false});
    assert.equal(saved.status,200);assert.equal(saved.body.passwordConfigured,true);
    for(const path of ['/api/obs','/api/obs/config','/api/obs/status']){
      const result=await f.request(path);assert.equal(result.status,200);
      assert.equal(JSON.stringify(result.body).includes(password),false,path);
    }
    const file=join(f.root,'match.json'),store=new Store(file);
    store.apply(randomUUID(),store.data.revision,{type:'reset_match'});
    for(const backup of [true,false]){
      const archive=archiveData(file,join(f.root,'uploads'),backup);
      assert.equal(archive.entries.some(entry=>entry.path.includes('obs-connection')),false);
      assert.equal(JSON.stringify(archive).includes(password),false);
    }
    const retained=await f.request('/api/obs/config','PUT',{lowDiskGb:15});
    assert.equal(retained.body.passwordConfigured,true,'saving a preset must not erase a retained password');
    const cleared=await f.request('/api/obs/config','PUT',{clearPassword:true});
    assert.equal(cleared.body.passwordConfigured,false);
  }finally{await f.close();}
});

test('OBS HTTP rejects malformed, oversized, unknown and wrong-method requests before acting',async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.request('/api/obs/command','POST',null)).status,400);
    assert.equal((await f.request('/api/obs/command','POST',[])).status,400);
    assert.equal((await f.request('/api/obs/config','POST',{})).status,405);
    assert.equal((await f.request('/api/obs/never-existed')).status,404);
    assert.equal((await f.request('/api/obs/command','POST',{type:'request',requestType:'StopRecord'})).status,400);
    assert.equal((await f.request('/api/obs/config','PUT',{password:'x'.repeat(66000)})).status,413);
    assert.equal(f.service.getConfig().passwordConfigured,false);
    assert.equal(f.service.getStatus().connection,'disconnected');
  }finally{await f.close();}
});
