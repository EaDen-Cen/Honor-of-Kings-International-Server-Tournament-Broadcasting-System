import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { captureRegion, captureRegions, decodeClientCapture, localCaptureRequest, recognizeClientFrame } from './capture.js';
import { Store } from './store.js';
import type { MatchSettings } from '../src/shared/types.js';
test('capture accepts bounded negative-monitor coordinates and rejects oversized/malformed regions',()=>{
  assert.deepEqual(captureRegion({x:-1920,y:0,width:100,height:100}),{x:-1920,y:0,width:100,height:100});
  for (const value of [null,{}, {x:0,y:0,width:99999,height:32},{x:0.5,y:0,width:32,height:32}]) assert.throws(()=>captureRegion(value));
});
test('lineup capture requires exactly ten valid player regions',()=>{
  const regions=Array.from({length:10},(_,index)=>({x:index*40,y:0,width:64,height:64}));
  assert.equal(captureRegions(regions).length,10);
  assert.throws(()=>captureRegions(regions.slice(0,9)));
  assert.throws(()=>captureRegions([...regions.slice(0,9),{x:0,y:0,width:10,height:64}]));
});
test('capture rejects remote, tunnel and cross-origin requests even with loopback proxy address',()=>{
  const request=(headers:IncomingMessage['headers'], remoteAddress='127.0.0.1')=>({headers,socket:{remoteAddress}} as IncomingMessage);
  assert.ok(localCaptureRequest(request({host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001'})));
  assert.ok(!localCaptureRequest(request({host:'127.0.0.1:3001','cf-connecting-ip':'1.2.3.4'})));
  assert.ok(!localCaptureRequest(request({host:'127.0.0.1:3001',origin:'https://example.com'})));
  assert.ok(!localCaptureRequest(request({host:'example.com'})));
  assert.ok(!localCaptureRequest(request({host:'127.0.0.1:3001'},'192.168.1.10')));
});
test('input/presentation settings are live to caster while gameplay remains authoritative and undoable',()=>{
  let now=0;const store=new Store(undefined,()=>now);
  const settings={...store.data.state,scoreDisplay:'boxes',bpInputMode:'screen'} as MatchSettings;
  store.apply('settings-001',0,{type:'settings',settings});
  assert.equal(store.snapshot('overlay').state.scoreDisplay,'boxes');
  assert.equal(store.snapshot('caster').state.bpInputMode,'screen');
  now=180000; assert.equal(store.snapshot('caster').state.bpInputMode,'screen');
  assert.throws(()=>store.apply('settings-002',1,{type:'settings',settings:{...settings,bpInputMode:'bad'} as unknown as MatchSettings}));
  assert.equal(store.data.revision,1);
  store.apply('undo-mode-001',1,{type:'undo'}); assert.equal(store.data.state.bpInputMode,'manual');
});


test('browser frame upload accepts bounded image data URLs only',()=>{
  const tiny='data:image/png;base64,'+Buffer.from('png').toString('base64');
  assert.equal(decodeClientCapture(tiny).toString(),'png');
  assert.throws(()=>decodeClientCapture('https://example.com/frame.png'));
  assert.throws(()=>decodeClientCapture('data:text/plain;base64,SGVsbG8='));
  assert.throws(()=>decodeClientCapture(123));
});

test('same portrait with a newly visible lock cue does not reuse stale cached lock evidence',async()=>{
  const sharp=(await import('sharp')).default;
  const portrait=await sharp({create:{width:96,height:96,channels:3,background:'#172334'}}).png().toBuffer();
  const locked=await sharp(Buffer.from('<svg width="96" height="96"><rect width="96" height="96" fill="#172334"/><path d="M 76 60 L 95 78 L 76 95 L 57 78 Z" fill="#126caa"/><path d="M 68 79 L 74 85 L 85 74" stroke="white" stroke-width="4" fill="none"/></svg>')).png().toBuffer();
  const data=(buffer:Buffer)=>'data:image/png;base64,'+buffer.toString('base64');
  const before=await recognizeClientFrame(data(portrait),[],'square',data(portrait));
  const after=await recognizeClientFrame(data(portrait),[],'square',data(locked));
  assert.equal(before.lockCue,'none');
  assert.equal(after.lockCue,'checkmark');
  assert.deepEqual(before.candidates,after.candidates);
});
