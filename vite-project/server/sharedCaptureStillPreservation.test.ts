import test from 'node:test';
import assert from 'node:assert/strict';
import { getSharedWindowCaptureStream, setSharedWindowCaptureStream, stopSharedBpWindow } from '../src/control/sharedWindowCapture.js';
import { getSharedGameStill, publishSharedGameStill } from '../src/control/sharedGameStill.js';
import { getSharedCaptureContent, setSharedCaptureContent } from '../src/control/sharedCaptureContent.js';

class CaptureTrack extends EventTarget {
  readyState='live';
  stop(){this.readyState='ended';}
  end(){this.readyState='ended';this.dispatchEvent(new Event('ended'));}
}

test('background BP disconnect preserves the uploaded screenshot and its selected game area',()=>{
  const track=new CaptureTrack();
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]} as unknown as MediaStream;
  const screenshot={image:{} as HTMLImageElement,name:'settlement.png'};
  const crop={x:0,y:40/1120,width:1,height:1080/1120};
  try{
    setSharedWindowCaptureStream(stream);
    publishSharedGameStill(screenshot);
    setSharedCaptureContent(crop);
    track.end();
    assert.equal(getSharedWindowCaptureStream(),undefined);
    assert.equal(getSharedGameStill(),screenshot);
    assert.deepEqual(getSharedCaptureContent(),crop);

    // Returning to a new live source still requires its own crop confirmation.
    const replacement=new CaptureTrack();
    setSharedWindowCaptureStream({getVideoTracks:()=>[replacement],getTracks:()=>[replacement]} as unknown as MediaStream);
    assert.equal(getSharedGameStill(),undefined);
    assert.equal(getSharedCaptureContent(),undefined);
    setSharedCaptureContent(crop);
    stopSharedBpWindow();
    assert.equal(getSharedCaptureContent(),undefined);
  }finally{stopSharedBpWindow();publishSharedGameStill(undefined);}
});
