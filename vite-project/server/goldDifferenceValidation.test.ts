import test from 'node:test';
import assert from 'node:assert/strict';
import {validGoldDifferencePoints,validGoldDifferenceTimeline} from '../src/shared/postGameTimeline.js';

test('partial curve duration retains the full observed axis without inventing points',()=>{
  const curve={points:[{timeSeconds:0,difference:0},{timeSeconds:590,difference:8500}],source:'settlement',confidence:.95,maxDifference:10700,partial:true,durationSeconds:660};
  assert.equal(validGoldDifferenceTimeline(curve),true);
  assert.equal(validGoldDifferenceTimeline({...curve,durationSeconds:589}),false);
  assert.equal(validGoldDifferenceTimeline({...curve,durationSeconds:7201}),false);
  assert.equal(validGoldDifferenceTimeline({...curve,durationSeconds:660.5}),false);
  assert.equal(validGoldDifferenceTimeline({...curve,durationSeconds:undefined}),true,'legacy curves need no duration metadata');
});

test('malformed and sparse curve samples fail validation safely',()=>{
  assert.equal(validGoldDifferencePoints(new Array(2)),false);
  const sparse=new Array(3);sparse[0]={timeSeconds:0,difference:0};sparse[2]={timeSeconds:10,difference:50};
  assert.equal(validGoldDifferencePoints(sparse),false);
  for(const bad of [null,{},[null,null],[{timeSeconds:0,difference:0},{timeSeconds:0,difference:1}],[{timeSeconds:0,difference:0},{timeSeconds:10,difference:NaN}]])assert.equal(validGoldDifferencePoints(bad),false);
});
