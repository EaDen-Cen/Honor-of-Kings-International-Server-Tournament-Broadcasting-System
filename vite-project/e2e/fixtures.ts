import { test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export { expect } from '@playwright/test';
export type { Page, Route } from '@playwright/test';

const project=fileURLToPath(new URL('../',import.meta.url));
const port=3101;
const host='127.0.0.1';

async function requireUnusedPort() {
  const probe=createServer();
  await new Promise<void>((resolve,reject)=>{
    probe.once('error',()=>reject(new Error(`E2E requires an unused ${host}:${port}. Stop the existing service before running tests; it will not be reused or stopped.`)));
    probe.listen({host,port,exclusive:true},()=>probe.close(error=>error?reject(error):resolve()));
  });
}

async function exitedWithin(closed:Promise<void>,milliseconds:number) {
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      closed.then(()=>true),
      new Promise<false>(resolve=>{timeout=setTimeout(()=>resolve(false),milliseconds);}),
    ]);
  }finally{clearTimeout(timeout);}
}

async function stopOwnedServer(child:ChildProcess,closed:Promise<void>) {
  if(child.exitCode!==null||child.signalCode!==null){await closed;return;}
  child.kill('SIGTERM');
  if(await exitedWithin(closed,5000))return;
  child.kill('SIGKILL');
  if(!await exitedWithin(closed,5000))throw new Error('The test server child did not exit after termination.');
}

// A new process and data directory isolate delayed caster events, access data,
// uploads and team presets as well as settings. Product reset semantics stay intact.
// Teardown only closes clients: resetting live state here can race automatic OCR.
export const test=base.extend<{ isolatedServer:void }>({
  isolatedServer:[async({baseURL},use)=>{
    if(baseURL!==`http://${host}:${port}`)throw new Error('E2E baseURL must point to its disposable local server.');
    await requireUnusedPort();
    await mkdir(join(project,'artifacts'),{recursive:true});
    const directory=await mkdtemp(join(project,'artifacts','e2e-'));
    const logPath=join(directory,'server.log');
    const log=openSync(logPath,'w');
    let child:ChildProcess;
    try{
      child=spawn(process.execPath,['--import','tsx','server/server.ts'],{
        cwd:project,
        env:{...process.env,PORT:String(port),HOST:host,NODE_ENV:'development',
          DATA_FILE:join(directory,'match.json'),UPLOAD_DIR:join(directory,'uploads','player-portraits'),
          CONTROL_TOKEN:'e2e-control',CASTER_TOKEN:'e2e-caster',OVERLAY_TOKEN:'e2e-overlay',ACCESS_PASSWORD:''},
        stdio:['ignore',log,log],
      });
    }finally{closeSync(log);}
    let launchError:Error|undefined;
    child.once('error',error=>{launchError=error;});
    const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
    try{
      const deadline=Date.now()+20000;
      let ready=false;
      while(Date.now()<deadline){
        if(launchError||child.exitCode!==null||child.signalCode!==null)throw new Error(`The isolated E2E server exited during startup. See ${logPath}`);
        // Wait for this child's listen callback, so a process racing for the
        // same port cannot be mistaken for the server owned by this fixture.
        const listening=(await readFile(logPath,'utf8')).includes(`HOK Broadcast server ready on port ${port}`);
        if(listening){
          try{
            const response=await fetch(`${baseURL}/api/health`,{signal:AbortSignal.timeout(750)});
            const health=await response.json() as {ok?:boolean};
            if(response.ok&&health.ok===true&&!launchError&&child.exitCode===null&&child.signalCode===null){ready=true;break;}
          }catch{/* The child may still be finishing startup; retry until deadline. */}
        }
        await pause(100);
      }
      if(!ready)throw new Error(`The isolated E2E server did not become healthy within 20 seconds. See ${logPath}`);
      await use();
    }finally{await stopOwnedServer(child,closed);}
  },{auto:true,timeout:30000}],
});
