import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCaptureSlots } from '../src/control/bpCaptureLayout.js';
import {
  createCaptureSlotPreset,
  readCaptureSlotPresets,
  updateCaptureSlotPreset,
} from '../src/control/captureSlotPresets.js';

test('capture preset round-trips all 20 normalized slots',()=>{
  const preset=createCaptureSlotPreset({
    id:'preset-1',
    name:'  1920x1080 比赛端  ',
    slots:defaultCaptureSlots,
    sourceWidth:1920,
    sourceHeight:1080,
    now:100,
  });
  const parsed=readCaptureSlotPresets(JSON.stringify([preset]));
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].name,'1920x1080 比赛端');
  assert.equal(Object.keys(parsed[0].slots).length,20);
  assert.deepEqual(parsed[0].slots,defaultCaptureSlots);
  assert.equal(parsed[0].sourceWidth,1920);
  assert.equal(parsed[0].sourceHeight,1080);
});

test('invalid capture presets are ignored without breaking valid presets',()=>{
  const valid=createCaptureSlotPreset({
    id:'valid',
    name:'Valid',
    slots:defaultCaptureSlots,
    now:100,
  });
  const parsed=readCaptureSlotPresets(JSON.stringify([
    null,
    {id:'missing-slots',name:'Bad'},
    valid,
  ]));
  assert.deepEqual(parsed.map(item=>item.id),['valid']);
});

test('updating a capture preset replaces all slots but preserves creation time',()=>{
  const original=createCaptureSlotPreset({
    id:'preset-1',
    name:'Original',
    slots:defaultCaptureSlots,
    now:100,
  });
  const changed={
    ...defaultCaptureSlots,
    bluePick1:{x:.2,y:.2,width:.1,height:.1},
  };
  const updated=updateCaptureSlotPreset(original,{
    name:'Updated',
    slots:changed,
    sourceWidth:2560,
    sourceHeight:1440,
    now:200,
  });
  assert.equal(updated.createdAt,100);
  assert.equal(updated.updatedAt,200);
  assert.equal(updated.name,'Updated');
  assert.deepEqual(updated.slots.bluePick1,changed.bluePick1);
  assert.equal(updated.sourceWidth,2560);
  assert.equal(updated.sourceHeight,1440);
});
