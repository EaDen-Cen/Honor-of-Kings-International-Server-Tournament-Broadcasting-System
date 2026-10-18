import test from 'node:test';
import assert from 'node:assert/strict';
import { beginSharedGameStillLoad, getSharedGameStill, publishLoadedSharedGameStill, publishSharedGameStill } from '../src/control/sharedGameStill.js';

test('the last screenshot selected across panels wins even when an earlier decode finishes first',()=>{
  const a={image:{} as HTMLImageElement,name:'old.png'},b={image:{} as HTMLImageElement,name:'latest.png'};
  try{
    const first=beginSharedGameStillLoad(),second=beginSharedGameStillLoad();
    assert.equal(publishLoadedSharedGameStill(first,a),false);
    assert.equal(getSharedGameStill(),undefined);
    assert.equal(publishLoadedSharedGameStill(second,b),true);
    assert.equal(getSharedGameStill(),b);
    assert.equal(publishLoadedSharedGameStill(first,a),false);
    assert.equal(getSharedGameStill(),b);
  }finally{publishSharedGameStill(undefined);}
});

test('choosing BP while a screenshot is decoding cancels the pending image even without a previously loaded image',()=>{
  const first=beginSharedGameStillLoad();
  publishSharedGameStill(undefined);
  assert.equal(publishLoadedSharedGameStill(first,{image:{} as HTMLImageElement,name:'late.png'}),false);
  assert.equal(getSharedGameStill(),undefined);
});
