import test from 'node:test';
import assert from 'node:assert/strict';
import { isBroadcastPageRoute } from './uiRoutes.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const roleRoutes=['/overlay/postgame-clash','/overlay/postgame-jungle','/overlay/postgame-mid','/overlay/postgame-farm','/overlay/postgame-roam'];

test('production backend serves the same SPA entry point for all published post-game overlays',()=>{
  for(const path of [...roleRoutes,'/overlay/mvp','/overlay/postgame-compare','/overlay/game-progress','/overlay/draft','/overlay/game-hud','/control','/caster'])
    assert.equal(isBroadcastPageRoute(path),true,path);
});
test('unknown overlays, arbitrary paths and API never silently fall through to an HTML shell',()=>{
  for(const path of ['/overlay/never-existed','/overlay/postgame-support','/overlay/postgame-clash/extra','/api/heroes','/dist/main.js','/overlay/postgame-compare/../bad','/overlay/postgame-compare%2Fbad'])
    assert.equal(isBroadcastPageRoute(path),false,path);
});

test('production HTTP serves all five fixed role URLs as the built app and keeps unknown URLs at 404',{timeout:30000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'hok-route-http-'));
  const listener=createServer();
  const port=await new Promise<number>((resolve,reject)=>{
    listener.once('error',reject);
    listener.listen(0,'127.0.0.1',()=>{
      const address=listener.address();
      if(!address||typeof address==='string'){reject(new Error('Could not reserve a test port'));return;}
      listener.close(error=>error?reject(error):resolve(address.port));
    });
  });
  const child=spawn(process.execPath,['--import','tsx','server/server.ts'],{
    env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DATA_FILE:join(root,'match.json'),UPLOAD_DIR:join(root,'uploads'),CONTROL_TOKEN:'route-test-control',CASTER_TOKEN:'route-test-caster',OVERLAY_TOKEN:'route-test-overlay'},
    stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  const exited=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.once('error',()=>resolve());});
  child.stderr.on('data',()=>{/* Drain startup diagnostics without exposing local configuration. */});
  try {
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Route test backend did not start')),15000);
      const finish=(error?:Error)=>{clearTimeout(timeout);if(error)reject(error);else resolve();};
      child.once('error',finish);child.once('exit',code=>finish(new Error(`Route test backend exited: ${code}`)));
      child.stdout.on('data',chunk=>{if(String(chunk).includes('HOK Broadcast server ready'))finish();});
    });
    const base=`http://127.0.0.1:${port}`,shell=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
    for(const path of roleRoutes){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.match(response.headers.get('content-type')||'',/^text\/html\b/);
      assert.equal(await response.text(),shell,`${path} must receive the actual built app, not an API error or fallback page`);
    }
    for(const path of ['/overlay/postgame-support','/overlay/postgame-clash/extra','/overlay/postgame-clash%2Fextra']){
      const response=await fetch(base+path);
      assert.equal(response.status,404,path);
      assert.match(response.headers.get('content-type')||'',/^application\/json\b/);
    }
  } finally {child.kill();await exited;rmSync(root,{recursive:true,force:true});}
});
