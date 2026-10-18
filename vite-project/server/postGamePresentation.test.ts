import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/shared/types.js';
import {mvpStatSelection,postGamePlayerIdentity} from '../src/shared/postGamePresentation.js';
import type {PostGamePlayer,PostGameReport,PostGameMetric} from '../src/shared/postGame.js';
const player=(values:Partial<Record<PostGameMetric,number>>={}):PostGamePlayer=>({rowId:'blue:0',rosterIndex:0,slot:0,side:'blue',playerId:'P1',teamName:'Blue',portrait:'',role:'clash',heroId:1,fields:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,sourcePage:'overview',confidence:.95,manual:false}]))});
test('MVP uses registered player role and portrait even after report creation, never P1 as clash',()=>{
  const state=initialState(),saved=player();state.blueTeam.id='blue';state.blueTeam.players[0]='P1';state.blueTeam.playerRoles[0]='jungle';state.blueTeam.playerPortraits[0]='/player.png';
  const actual=postGamePlayerIdentity(state,saved);
  assert.equal(actual.role,'jungle');assert.equal(actual.portrait,'/player.png');assert.equal(actual.heroId,saved.heroId);
  [state.blueTeam,state.redTeam]=[state.redTeam,state.blueTeam];assert.equal(postGamePlayerIdentity(state,saved).role,'jungle','team identity survives side swaps');
  state.redTeam.players[0]='Replacement';assert.equal(postGamePlayerIdentity(state,saved).role,'clash','a different player cannot supply historical role or photo');
});
test('three role statistics exclude repeated metric families from strongest same-team highlights',()=>{
  const selected=player({damageTaken:50000,participation:80,totalDamage:40000,damageShare:30,damageTakenShare:40,healing:10000,healingShare:80,gold:10000,goldShare:30,damageConversion:1.8});
  const peers=Array.from({length:4},(_,i)=>({...player({damageTaken:30000,participation:60,totalDamage:30000,damageShare:20,damageTakenShare:15,healing:1000,healingShare:5,gold:8000,goldShare:20,damageConversion:.6}),rowId:`blue:${i+1}`}));
  const report={players:[selected,...peers]} as PostGameReport,stats=mvpStatSelection(selected,report);
  assert.deepEqual(stats.primary,['damageTaken','participation','totalDamage']);assert.equal(stats.highlights.length,3);
  assert.ok(stats.highlights.every(key=>!stats.primary.includes(key)&&key!=='damageShare'&&key!=='damageTakenShare'));
  assert.ok(stats.highlights.includes('healingShare'));assert.ok(!(stats.highlights.includes('gold')&&stats.highlights.includes('goldShare')));
  selected.role='roam';assert.deepEqual(mvpStatSelection(selected,report).primary,['participation','healing','control']);
});
test('missing and uncertain metrics never become made-up MVP highlights',()=>{
  const selected=player();selected.fields.gold={value:10000,confidence:.5,manual:false,sourcePage:'economy'};
  const stats=mvpStatSelection(selected,{players:[selected]} as PostGameReport);
  assert.equal(stats.primary.length,3);assert.deepEqual(stats.highlights,[]);
});
