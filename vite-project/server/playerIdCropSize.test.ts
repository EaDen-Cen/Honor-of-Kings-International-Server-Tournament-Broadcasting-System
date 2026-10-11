import test from 'node:test';import assert from 'node:assert/strict';
import {playerIdCropSize} from '../src/control/playerIdCropSize.js';
test('ID OCR crops preserve glyph aspect ratio at either size limit',()=>{
  assert.deepEqual(playerIdCropSize(100,20),{width:200,height:40});
  assert.deepEqual(playerIdCropSize(1000,100),{width:760,height:76});
  assert.deepEqual(playerIdCropSize(200,200),{width:180,height:180});
  assert.deepEqual(playerIdCropSize(800,400),{width:360,height:180});
});
