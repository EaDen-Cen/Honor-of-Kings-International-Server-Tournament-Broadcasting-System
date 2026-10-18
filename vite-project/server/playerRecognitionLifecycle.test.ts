import test from 'node:test';
import assert from 'node:assert/strict';
import type {createWorker,Worker} from 'tesseract.js';
import {PlayerRecognitionProvider} from './playerRecognition.js';

function worker(name:string,terminated:string[],configure=async()=>{},terminationFails=false):Worker {
  return {
    setParameters:configure,
    terminate:async()=>{terminated.push(name);if(terminationFails)throw new Error('Termination failed');},
  } as unknown as Worker;
}

test('a failed language load cleans up later successful workers and permits a fresh retry',async()=>{
  const terminated:string[]=[];let fail=true;
  const factory:typeof createWorker=async language=>{
    const name=String(language);
    if(name==='chi_sim'&&fail)throw new Error('Chinese model unavailable');
    // This successful worker arrives after the other language has rejected.
    await new Promise<void>(resolve=>setImmediate(resolve));
    return worker(name,terminated,undefined,fail);
  };
  const provider=new PlayerRecognitionProvider(undefined,'eng+chi_sim',factory);
  await provider.prepare();
  assert.equal(provider.status,'error');assert.equal(provider.error,'Chinese model unavailable');
  assert.deepEqual(terminated,['eng'],'a cleanup error must not hide the original model failure');
  fail=false;
  await provider.prepare();
  assert.equal(provider.status,'ready');assert.equal(provider.error,'');
  await provider.close();
  assert.deepEqual(terminated,['eng','eng','chi_sim'],'failed workers are not retained for a second termination');
});

test('parameter configuration failure terminates every created language worker',async()=>{
  const terminated:string[]=[];
  const factory:typeof createWorker=async language=>worker(String(language),terminated,async()=>{
    if(language==='chi_sim')throw new Error('Parameters rejected');
  });
  const provider=new PlayerRecognitionProvider(undefined,'eng+chi_sim',factory);
  await provider.prepare();
  assert.equal(provider.status,'error');assert.equal(provider.error,'Parameters rejected');
  assert.deepEqual(terminated,['eng','chi_sim']);
  await provider.close();assert.equal(terminated.length,2);
});

test('a failed numeric worker configuration is cleaned up without disabling player OCR',async()=>{
  const terminated:string[]=[];let created=0;
  const factory:typeof createWorker=async()=>{
    const name=created++===0?'players':'numbers';
    return worker(name,terminated,async()=>{if(name==='numbers')throw new Error('Numeric parameters rejected');});
  };
  const provider=new PlayerRecognitionProvider(undefined,'eng',factory);
  await provider.prepare();assert.equal(provider.status,'ready');
  await assert.rejects(provider.recognizeNumbers(['data:image/png;base64,AAAA']),/Numeric parameters rejected/);
  assert.equal(provider.status,'ready');assert.deepEqual(terminated,['numbers']);
  await provider.close();assert.deepEqual(terminated,['numbers','players']);
});
