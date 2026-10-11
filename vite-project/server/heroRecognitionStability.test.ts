import test from 'node:test';
import assert from 'node:assert/strict';
import { updateHeroRecognitionStability, type HeroRecognitionStability } from '../src/control/heroRecognitionStability.js';

const fresh:HeroRecognitionStability={phaseKey:'',heroId:null,count:0};

test('high-confidence hero review requires two stable scans',()=>{
  const first=updateHeroRecognitionStability(fresh,'g1:p4',[
    {heroId:10,confidence:.72},
    {heroId:11,confidence:.61},
  ]);
  assert.equal(first.accepted,false);
  assert.equal(first.requiredScans,2);
  assert.equal(first.stability.count,1);

  const second=updateHeroRecognitionStability(first.stability,'g1:p4',[
    {heroId:10,confidence:.70},
    {heroId:11,confidence:.60},
  ]);
  assert.equal(second.accepted,true);
  assert.equal(second.stability.count,2);
});

test('persistent low-confidence mistakes never stabilize through repetition',()=>{
  for(const confidence of [.28,.37,.48,.54]) {
    let state:HeroRecognitionStability=fresh;
    for(let scan=0;scan<20;scan++) {
      const result=updateHeroRecognitionStability(state,'g1:p4',[{heroId:26,confidence},{heroId:10,confidence:.20}]);
      state=result.stability;
      assert.equal(result.accepted,false);
      assert.equal(result.requiredScans,0);
    }
  }
});

test('medium-confidence separated candidates require three scans',()=>{
  let state:HeroRecognitionStability=fresh;
  for(let scan=1;scan<=3;scan++){
    const result=updateHeroRecognitionStability(state,'g1:p4',[
      {heroId:26,confidence:.58},
      {heroId:10,confidence:.48},
    ]);
    state=result.stability;
    assert.equal(result.requiredScans,3);
    assert.equal(result.accepted,scan===3);
  }
});

test('ambiguous candidates and phase changes reset stable hero evidence',()=>{
  const ambiguous=updateHeroRecognitionStability(fresh,'g1:p4',[
    {heroId:10,confidence:.70},
    {heroId:11,confidence:.68},
  ]);
  assert.equal(ambiguous.accepted,false);
  assert.equal(ambiguous.requiredScans,0);
  assert.equal(ambiguous.stability.count,0);

  const previous={phaseKey:'g1:p4',heroId:10,count:1};
  const nextPhase=updateHeroRecognitionStability(previous,'g1:p5',[
    {heroId:10,confidence:.75},
    {heroId:11,confidence:.50},
  ]);
  assert.equal(nextPhase.accepted,false);
  assert.equal(nextPhase.requiredScans,2);
  assert.equal(nextPhase.stability.count,1);
});
