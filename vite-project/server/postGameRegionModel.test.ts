import test from 'node:test';
import assert from 'node:assert/strict';
import { validPostGameRegion, replicateTeamFieldRegions } from '../src/control/postGameRegionModel.js';
test('visual OCR boxes must be finite, in bounds and large enough to hold digits',()=>{
  assert.equal(validPostGameRegion({x:.3,y:.2,width:.08,height:.032}),true);
  for(const invalid of [{x:0,y:0,width:0,height:.03},{x:.99,y:.5,width:.1,height:.1},{x:NaN,y:.2,width:.1,height:.02},{x:.4,y:.3,width:Infinity,height:.1}])assert.equal(validPostGameRegion(invalid),false);
});
test('copying one OCR rectangle stays within five-person team, never overwrites opponents',()=>{
  const start=Array(10).fill(undefined);start[2]={x:.44,y:.42,width:.08,height:.03};start[5]={x:.8,y:.1,width:.05,height:.04};
  const result=replicateTeamFieldRegions(start,2);
  assert.equal(result[2]?.y,.42);
  assert.equal(result[0]?.x,.44);
  assert.equal(result[4]?.y,.42+2*130/1080);
  assert.deepEqual(result.slice(5),start.slice(5));
});
