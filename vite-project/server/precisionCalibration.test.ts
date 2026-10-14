import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSlotKeys } from '../src/control/bpCaptureLayout.js';
import { nextCaptureSlotKey, nudgeCaptureRegion } from '../src/control/precisionCalibration.js';

test('pixel nudges map back to normalized source coordinates',()=>{
  const base={x:.25,y:.25,width:.1,height:.1};
  const moved=nudgeCaptureRegion(base,1920,1080,{dx:1,dy:-1});
  assert.ok(Math.abs(moved.x-(base.x+1/1920))<1e-10);
  assert.ok(Math.abs(moved.y-(base.y-1/1080))<1e-10);
  assert.equal(moved.width,base.width);
  assert.equal(moved.height,base.height);

  const resized=nudgeCaptureRegion(base,1920,1080,{dw:1,dh:1});
  assert.ok(Math.abs(resized.width-(base.width+1/1920))<1e-10);
  assert.ok(Math.abs(resized.height-(base.height+1/1080))<1e-10);
});

test('precision calibration next/previous navigation cycles through all 20 slots',()=>{
  assert.equal(captureSlotKeys.length,20);
  const first=captureSlotKeys[0];
  const second=captureSlotKeys[1];
  const last=captureSlotKeys[captureSlotKeys.length-1];
  assert.equal(nextCaptureSlotKey(first,1),second);
  assert.equal(nextCaptureSlotKey(first,-1),last);
  assert.equal(nextCaptureSlotKey(last,1),first);
});
