import test from 'node:test';
import assert from 'node:assert/strict';
import {requestWindowCapture} from '../src/control/sharedWindowCapture.js';

test('window capture excludes cursor at selection and enforces supported track constraints',async()=>{
  let selected:unknown,applied:unknown,stopped=false;
  const track={getCapabilities:()=>({cursor:['always','never']}),getConstraints:()=>({frameRate:30}),applyConstraints:async(value:unknown)=>{applied=value;},stop:()=>{stopped=true;}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const before=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:async(value:unknown)=>{selected=value;return stream;}}});
  try{
    assert.equal(await requestWindowCapture(),stream);
    assert.deepEqual(selected,{video:{cursor:'never'},audio:false});
    assert.deepEqual(applied,{frameRate:30,cursor:{exact:'never'}});
    assert.equal(stopped,false);
    track.applyConstraints=async()=>{throw new Error('capture constraint failed');};
    await assert.rejects(requestWindowCapture(),/capture constraint failed/);
    assert.equal(stopped,true,'failed capture must release the active stream');
  }finally{
    if(before)Object.defineProperty(navigator,'mediaDevices',before);
    else Reflect.deleteProperty(navigator,'mediaDevices');
  }
});
