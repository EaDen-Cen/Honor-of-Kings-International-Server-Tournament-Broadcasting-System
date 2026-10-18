import test from 'node:test';
import assert from 'node:assert/strict';
import { connectSharedBpWindow, getSharedWindowCaptureStream, setSharedWindowCaptureStream, stopSharedBpWindow, subscribeSharedWindowCapture } from '../src/control/sharedWindowCapture.js';
import { getSharedGameStill, publishSharedGameStill } from '../src/control/sharedGameStill.js';
import { getSharedCaptureContent, setSharedCaptureContent } from '../src/control/sharedCaptureContent.js';

class Track extends EventTarget {
  readyState='live';stopped=false;
  getCapabilities(){return {};}
  stop(){this.stopped=true;this.readyState='ended';}
  end(){this.readyState='ended';this.dispatchEvent(new Event('ended'));}
}
const source=()=>{const track=new Track();return {track,stream:{getVideoTracks:()=>[track],getTracks:()=>[track]} as unknown as MediaStream};};
test('all consumers share one BP selection; cancellation preserves the old window and late ended events cannot clear a replacement',async()=>{
  const before=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');
  const first=source(),second=source();let calls=0,reject=false;
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:async()=>{calls++;if(reject)throw new Error('user cancelled');return calls===1?first.stream:second.stream;}}});
  const updates:Array<MediaStream|undefined>=[];const unsubscribe=subscribeSharedWindowCapture(stream=>updates.push(stream));
  try{
    const [a,b]=await Promise.all([connectSharedBpWindow(),connectSharedBpWindow()]);
    assert.equal(calls,1);assert.equal(a,b);assert.equal(await connectSharedBpWindow(),a);
    reject=true;await assert.rejects(connectSharedBpWindow(true),/cancelled/);
    assert.equal(getSharedWindowCaptureStream(),first.stream);assert.equal(first.track.stopped,false);
    publishSharedGameStill({image:{} as HTMLImageElement,name:'review.png'});
    setSharedCaptureContent({x:.1,y:.1,width:.8,height:.8});
    setSharedWindowCaptureStream(second.stream);
    assert.equal(first.track.stopped,true);assert.equal(getSharedGameStill(),undefined);assert.equal(getSharedCaptureContent(),undefined);
    first.track.end();assert.equal(getSharedWindowCaptureStream(),second.stream);
    second.track.end();assert.equal(getSharedWindowCaptureStream(),undefined);assert.equal(updates.at(-1),undefined);
  }finally{unsubscribe();stopSharedBpWindow();publishSharedGameStill(undefined);if(before)Object.defineProperty(navigator,'mediaDevices',before);else Reflect.deleteProperty(navigator,'mediaDevices');}
});
test('stopping while a picker is pending releases the new stream instead of reconnecting it',async()=>{
  const before=Object.getOwnPropertyDescriptor(navigator,'mediaDevices'),next=source();let release!:(stream:MediaStream)=>void;
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:()=>new Promise<MediaStream>(resolve=>{release=resolve;})}});
  try{
    const pending=connectSharedBpWindow();stopSharedBpWindow();release(next.stream);
    await assert.rejects(pending,/cancelled/);assert.equal(next.track.stopped,true);assert.equal(getSharedWindowCaptureStream(),undefined);
  }finally{stopSharedBpWindow();if(before)Object.defineProperty(navigator,'mediaDevices',before);else Reflect.deleteProperty(navigator,'mediaDevices');}
});
