import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import heroes from '../src/components/HeroList.js';
import { initialState, phases } from '../src/shared/types.js';
import { draftHeroGroupKey, draftHeroUsed, draftRestriction } from '../src/shared/draftRules.js';
import { randomizeSimulatorSlots, simulatorSlotForPhase, simulatorSlotKey } from '../src/simulator/bpSimulatorModel.js';
import { shouldAutoAcceptRecognition } from '../src/control/recognitionAcceptance.js';
import { AccessStore } from './access.js';
import { recognizeClientFrame, recognizePortraitCandidates } from './capture.js';
import { Store } from './store.js';

test('password persists, rotates all role tokens, rejects old tokens and never stores plaintext',()=>{
  const file=join(mkdtempSync(join(tmpdir(),'hok-access-')),'access.json');
  const access=new AccessStore(file);
  const old=access.token('control');
  assert.throws(()=>access.setPassword('short'));
  access.setPassword('long-custom-password');
  assert.equal(access.role(old),undefined);
  assert.equal(access.verify('wrong'),false);
  assert.equal(access.verify('long-custom-password'),true);
  const saved=new AccessStore(file);
  assert.equal(saved.token('control'),access.token('control'));
  assert.equal(saved.verify('long-custom-password'),true);
  assert(!readFileSync(file,'utf8').includes('long-custom-password'));
  assert.equal(new Set(['control','caster','overlay'].map(role=>saved.token(role as 'control'))).size,3);
});

test('random simulator uses Control global history, merged Flowborn and sequential duplicate checks',()=>{
  const rules=initialState();rules.flowbornFormsIndependent=false;rules.draftRuleMode='global';
  rules.draftHistory=[{id:'history',gameNumber:1,committedAt:0,firstPickSide:'blue',blueTeam:rules.blueTeam,redTeam:rules.redTeam,blueBans:[],redBans:[],bluePicks:[heroes[0].id],redPicks:[heroes[1].id],blueAssignments:[heroes[0].id],redAssignments:[heroes[1].id]}];
  const sequence=phases('match','red');
  const slots=sequence.map((_,index)=>simulatorSlotForPhase('match','red',index)!);
  const keys=new Set(slots.map(simulatorSlotKey));
  for(let run=0;run<30;run++) {
    const output=randomizeSimulatorSlots({},'match','red',rules,keys,[],()=>run/30);
    const draft={...rules,blueBans:[] as (number|null)[],redBans:[] as (number|null)[],bluePicks:[] as number[],redPicks:[] as number[]};
    const groups=new Set<string>();
    for(const slot of slots) {
      const hero=output[simulatorSlotKey(slot)];
      assert(!draftHeroUsed(draft,hero));assert(!draftRestriction(draft,slot.side,slot.action,hero));
      assert(!groups.has(draftHeroGroupKey(draft,hero)));groups.add(draftHeroGroupKey(draft,hero));
      draft[`${slot.side}${slot.action==='ban'?'Bans':'Picks'}`].push(hero);
    }
  }
});

test('automatic acceptance requires all group scores strictly above a valid threshold',()=>{
  assert.equal(shouldAutoAcceptRecognition(true,90,[.95,.90]),false);
  assert.equal(shouldAutoAcceptRecognition(true,50,[.51,.8]),true);
  assert.equal(shouldAutoAcceptRecognition(true,100,[1]),false);
  for(const scores of [[],[NaN],[Infinity],[1.1]]) assert.equal(shouldAutoAcceptRecognition(true,50,scores),false);
  assert.equal(shouldAutoAcceptRecognition(false,50,[.99]),false);
});

test('exact-frame cache preserves evidence and isolates allowed pools, shape and caller mutations',async()=>{
  const image='data:image/png;base64,'+readFileSync('public'+heroes[0].imageLink).toString('base64');
  const first=await recognizeClientFrame(image,[heroes[0].id]);
  const expected=structuredClone(first);
  first.candidates[0].heroId=-1;
  assert.deepEqual(await recognizeClientFrame(image,[heroes[0].id]),expected);
  assert.deepEqual((await recognizeClientFrame(image,[])).candidates,[]);
  assert((await recognizeClientFrame(image,[heroes[1].id],'circle')).candidates.every(candidate=>candidate.heroId===heroes[1].id));
});

test('identical final-lineup requests coalesce and a new candidate domain is scored independently', async () => {
  const image = 'data:image/png;base64,' + readFileSync(new URL('../public' + heroes[0].imageLink, import.meta.url)).toString('base64');
  const pool = heroes.slice(0, 6).map(hero => hero.id);
  const simultaneous = await Promise.all(Array.from({length: 8}, () => recognizePortraitCandidates(image, pool)));
  assert.equal(simultaneous[0].candidates[0].heroId, heroes[0].id);
  simultaneous[0].candidates.length = 0;
  const again = await recognizePortraitCandidates(image, [...pool].reverse());
  assert.deepEqual(again, simultaneous[1]);
  assert.deepEqual((await recognizePortraitCandidates(image, [])).candidates, []);
  assert.deepEqual((await recognizePortraitCandidates(image, [heroes[1].id])).candidates.map(item => item.heroId), [heroes[1].id]);
  const sharp = (await import('sharp')).default;
  const large = await sharp({create:{width:2001,height:2000,channels:3,background:'#222'}}).png().toBuffer();
  await assert.rejects(recognizePortraitCandidates('data:image/png;base64,' + large.toString('base64'), pool), /dimensions/);
});

test('snapshot cache version changes when delayed event becomes due without a new action',()=>{
  let now=0;const store=new Store(undefined,()=>now);
  store.apply('action-123',0,{type:'draft_action',team:'blue',action:'ban',heroId:heroes[0].id});
  const version=store.snapshotVersion('caster');
  now=180000;
  assert.notEqual(store.snapshotVersion('caster'),version);
  assert.equal(store.snapshot('caster').state.blueBans[0],heroes[0].id);
});
