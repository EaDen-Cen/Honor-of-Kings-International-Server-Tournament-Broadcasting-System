import test from 'node:test';
import assert from 'node:assert/strict';
import {phaseName} from '../src/shared/display.js';
import {initialState,phases} from '../src/shared/types.js';
import {translate} from '../src/shared/i18n.js';

test('phase labels follow the configured Ban count and first-pick side through completion',()=>{
  for(const draftMode of ['match','normal'] as const)for(const firstPickSide of ['blue','red'] as const)for(const banCount of [0,1,2,3,4,5] as const){
    const state={...initialState(),draftMode,firstPickSide,banCount};
    const sequence=phases(draftMode,firstPickSide,banCount);
    for(const language of ['zh','eng'] as const){
      sequence.forEach((phase,currentPhase)=>{
        state.currentPhase=currentPhase;
        assert.equal(phaseName(state,language),translate(language,phase.action==='ban'?'banHero':'pickHero',{team:state[`${phase.team}Team`].name}),`${draftMode}/${firstPickSide}/${banCount}/${currentPhase}/${language}`);
      });
      state.currentPhase=sequence.length;
      assert.equal(phaseName(state,language),translate(language,'draftComplete'));
    }
  }
});
