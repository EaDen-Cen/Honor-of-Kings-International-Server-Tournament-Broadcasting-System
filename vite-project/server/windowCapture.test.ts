import test from 'node:test';
import assert from 'node:assert/strict';
import {getSharedWindowCaptureStream, invalidateWindowCaptureSelection, requestWindowCapture, setSharedWindowCaptureStream, subscribeSharedWindowCapture} from '../src/control/sharedWindowCapture.js';
import {CaptureRequest} from '../src/control/captureRequest.js';

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

class CaptureTrack extends EventTarget {
  readyState='live';
  stops=0;
  getCapabilities(){return {};}
  stop(){this.stops++;this.readyState='ended';}
  end(){this.readyState='ended';this.dispatchEvent(new Event('ended'));}
}
class CaptureStream extends EventTarget {
  track=new CaptureTrack();
  getVideoTracks(){return [this.track];}
  getTracks(){return [this.track];}
}
const mediaStream=(stream:CaptureStream)=>stream as unknown as MediaStream;

test('shared capture replacement releases old tracks and ending the source notifies every consumer',()=>{
  const first=new CaptureStream(),second=new CaptureStream(),events:Array<MediaStream|undefined>=[];
  const unsubscribe=subscribeSharedWindowCapture(stream=>events.push(stream));
  try{
    setSharedWindowCaptureStream(mediaStream(first));
    setSharedWindowCaptureStream(mediaStream(first));
    assert.equal(first.track.stops,0,'re-attaching the same source keeps capture alive');
    setSharedWindowCaptureStream(mediaStream(second));
    assert.equal(first.track.stops,1,'changing source releases the previous window');
    first.track.end();
    assert.equal(getSharedWindowCaptureStream(),second,'an old source must not disconnect the replacement');
    second.track.end();
    assert.equal(getSharedWindowCaptureStream(),undefined);
    assert.deepEqual(events,[first,second,undefined]);
    assert.equal(second.track.stops,1);
  }finally{unsubscribe();setSharedWindowCaptureStream(undefined);}
});

test('late or cancelled window selections release their streams and preserve the working source',async()=>{
  const working=new CaptureStream(),late=new CaptureStream(),latest=new CaptureStream();
  let resolveFirst!:(stream:CaptureStream)=>void;
  let calls=0;
  const before=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:()=>++calls===1?new Promise<CaptureStream>(resolve=>{resolveFirst=resolve;}):Promise.resolve(latest)}});
  setSharedWindowCaptureStream(mediaStream(working));
  try{
    const obsolete=requestWindowCapture();
    const rejected=assert.rejects(obsolete,{name:'AbortError'});
    assert.equal(await requestWindowCapture(),latest);
    resolveFirst(late);await rejected;
    assert.equal(late.track.stops,1);
    assert.equal(getSharedWindowCaptureStream(),working,'selection alone must not interrupt the active source');
    const controller=new AbortController();
    controller.abort();
    await assert.rejects(requestWindowCapture(controller.signal),{name:'AbortError'});
    assert.equal(calls,2,'an already cancelled request does not open another browser chooser');
    const pendingController=new AbortController();
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:async()=>{pendingController.abort();return late;}}});
    await assert.rejects(requestWindowCapture(pendingController.signal),{name:'AbortError'});
    assert.equal(late.track.stops,2,'a chooser that completes after unmount releases its stream');
  }finally{
    setSharedWindowCaptureStream(undefined);
    latest.track.stop();
    if(before)Object.defineProperty(navigator,'mediaDevices',before);
    else Reflect.deleteProperty(navigator,'mediaDevices');
  }
});

test('cancelled OCR work cannot publish or release a newer request and a timeout permits retry',async()=>{
  const work=new CaptureRequest();
  const stale=work.start(1000);
  work.cancel();
  assert.equal(stale.signal.aborted,true);
  assert.equal(stale.isCurrent(),false,'a cancelled response must not publish');
  const fresh=work.start(1000);
  assert.equal(stale.finish(),false,'old finally cannot reset a new request busy state');
  assert.equal(fresh.isCurrent(),true);
  assert.equal(fresh.finish(),true);
  const timeout=work.start(1);
  await new Promise<void>(resolve=>timeout.signal.addEventListener('abort',()=>resolve(),{once:true}));
  assert.equal(timeout.signal.reason.name,'TimeoutError');
  assert.equal(timeout.finish(),true,'the timeout still owns cleanup');
  const retry=work.start(1000);
  assert.equal(retry.signal.aborted,false);
  assert.equal(retry.finish(),true);
});

test('choosing a screenshot in another panel supersedes a window chooser that is still open',async()=>{
  const late=new CaptureStream();let resolveSelection!:(stream:CaptureStream)=>void;
  const before=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:()=>new Promise<CaptureStream>(resolve=>{resolveSelection=resolve;})}});
  try{
    const selection=requestWindowCapture();const rejected=assert.rejects(selection,{name:'AbortError'});
    invalidateWindowCaptureSelection();resolveSelection(late);await rejected;
    assert.equal(late.track.stops,1,'the screenshot stays selected and the abandoned window is released');
  }finally{
    if(before)Object.defineProperty(navigator,'mediaDevices',before);
    else Reflect.deleteProperty(navigator,'mediaDevices');
  }
});
