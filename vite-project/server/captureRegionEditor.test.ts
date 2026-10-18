import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCaptureRect, moveCaptureRect, resizeCaptureRect } from '../src/control/captureRegionEditor.js';
import { validCaptureRect } from '../src/shared/gameCapture.js';

test('content selection preserves 16:9 in either drag direction on an emulator frame',()=>{
  const aspect=16/9*1120/1920;
  for(const [a,b] of [[{x:0,y:40/1120},{x:1,y:1}],[{x:1,y:1},{x:0,y:40/1120}]]){
    const rect=drawCaptureRect(a,b,aspect);
    assert.ok(validCaptureRect(rect));assert.ok(Math.abs(rect.width*1920/(rect.height*1120)-16/9)<1e-9);
    assert.ok(Math.abs(rect.y-40/1120)<1e-9);
  }
});
test('moving and resizing boxes keeps edges in bounds without inflating small digit crops',()=>{
  const tiny=drawCaptureRect({x:.2,y:.2},{x:.21,y:.215});
  assert.ok(tiny.width<.02&&tiny.height<.02);
  assert.deepEqual(moveCaptureRect(tiny,-1,-1),{...tiny,x:0,y:0});
  const moved=moveCaptureRect(tiny,2,2);assert.ok(validCaptureRect(moved));assert.equal(moved.x,1-tiny.width);
  const resized=resizeCaptureRect({x:.2,y:.3,width:.1,height:.1},'nw',{x:.1,y:.2});
  assert.ok(Math.abs(resized.x-.1)<1e-9&&Math.abs(resized.width-.2)<1e-9);
  assert.ok(validCaptureRect(drawCaptureRect({x:-.2,y:-.2},{x:2,y:2})));
});
