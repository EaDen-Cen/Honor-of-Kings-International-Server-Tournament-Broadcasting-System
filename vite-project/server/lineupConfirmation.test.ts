import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/shared/types.js';
import { lineupIdentityContext, lineupWriteContext } from '../src/shared/lineupContext.js';
import { reconcileLineupSubmission, reviewedLineupTarget, trustedLineup, type LineupCandidate, type LineupSubmission } from '../src/control/lineupConfirmation.js';

const fixture=()=>{
  const state=initialState();state.draftComplete=true;state.currentPhase=18;
  state.bluePicks=[1,2,3,4,5];state.redPicks=[6,7,8,9,10];state.blueAssignments=[1,2,3,4,5];state.redAssignments=[6,7,8,9,10];
  const target={blue:[2,1,3,4,5],red:[7,6,8,9,10]};
  const submission:LineupSubmission={id:'own-write',target,identityContext:lineupIdentityContext(state),expectedContext:lineupWriteContext(state),baseRevision:10,submittedAt:1000,phase:'submitting'};
  return {state,target,submission};
};

test('lineup success requires its own ACK, increased revision and matching authoritative arrays',()=>{
  const {state,target,submission}=fixture(),saved={...state,blueAssignments:target.blue,redAssignments:target.red};
  assert.equal(reconcileLineupSubmission(submission,saved,11,undefined,1001).phase,'submitting');
  assert.equal(reconcileLineupSubmission(submission,saved,11,{id:'other-write',status:'acknowledged',revision:11},1001).phase,'submitting');
  assert.equal(reconcileLineupSubmission(submission,saved,10,{id:'own-write',status:'acknowledged',revision:10},1001).phase,'submitting');
  const waiting=reconcileLineupSubmission(submission,state,10,{id:'own-write',status:'acknowledged',revision:11},1001);
  assert.equal(waiting.phase,'submitting');
  assert.equal(reconcileLineupSubmission(waiting,saved,11,undefined,1002).phase,'applied');
});

test('rejection, lost connection, ACK without matching persistence and changed game stay visible',()=>{
  const {state,submission}=fixture();
  assert.equal(reconcileLineupSubmission(submission,state,10,{id:'own-write',status:'rejected',error:'invalid lineup'},1001).error,'invalid lineup');
  assert.equal(reconcileLineupSubmission(submission,state,10,{id:'own-write',status:'unconfirmed'},1001).phase,'unconfirmed');
  assert.equal(reconcileLineupSubmission(submission,state,11,{id:'own-write',status:'acknowledged',revision:11},11001).phase,'unconfirmed');
  assert.equal(reconcileLineupSubmission(submission,{...state,gameNumber:2},11,{id:'own-write',status:'acknowledged',revision:11},1001).phase,'expired');
});

test('manual one-team review uses only trusted OCR and preserves the other legal saved assignment',()=>{
  const {state}=fixture(),solution={heroes:[2,1,3,4,5],confidence:[.8,.8,.8,.8,.5],minimum:.5,average:.74};
  const candidate:LineupCandidate={results:[],blue:solution,red:{...solution,heroes:[7,6,8,9,10],minimum:.49},identityContext:lineupIdentityContext(state),writeContext:lineupWriteContext(state),signature:'candidate',stableCount:2};
  assert.equal(trustedLineup(candidate.red),false);
  assert.equal(reviewedLineupTarget(candidate,state),undefined);
  assert.deepEqual(reviewedLineupTarget(candidate,state,'blue'),{blue:solution.heroes,red:state.redAssignments});
  assert.equal(reviewedLineupTarget(candidate,{...state,redAssignments:[6,6,8,9,10]},'blue'),undefined);
  assert.equal(reviewedLineupTarget(candidate,{...state,blueAssignments:[2,1,3,4,5]},'blue'),undefined,'a previous proposal cannot overwrite an intervening manual swap');
});
