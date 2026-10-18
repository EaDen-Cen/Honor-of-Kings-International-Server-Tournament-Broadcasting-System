import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from './store.js';
import { AccessStore } from './access.js';
import { archiveData, RecoveryManager, restoreArchive, validateArchive, acquireBackendLock } from './recovery.js';
import { initialState, phases, type Action } from '../src/shared/types.js';
import { heroesForPool, heroAllowed } from '../src/shared/heroPool.js';
function setup(){const root=mkdtempSync(join(tmpdir(),'hok-recovery-')),file=join(root,'match.json'),uploads=join(root,'uploads/player-portraits');const s=new Store(file);s.apply(randomUUID(),0,{type:'delay',seconds:10});new AccessStore(join(root,'access.json'));mkdirSync(uploads,{recursive:true});writeFileSync(join(uploads,'photo.png'),Buffer.from('portrait'));return {root,file,uploads,s};}
test('automatic backup retains snapshots, deduplicates unchanged data, restores stores and photos',()=>{
  const {root,file,uploads,s}=setup();
  try{
    const manager=new RecoveryManager(file,uploads,join(root,'backups'),2),first=manager.create()!;
    assert.equal(manager.create(),undefined);
    const archive=JSON.parse(readFileSync(join(root,'backups',first),'utf8'));
    s.apply(randomUUID(),s.data.revision,{type:'delay',seconds:20});manager.create();manager.create(true);
    assert.equal(manager.list().length,2);
    rmSync(join(uploads,'photo.png'));restoreArchive(archive,file,uploads);
    assert.equal(new Store(file).data.delay,10);assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'portrait');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('exports omit credentials; import preserves destination access; active backend prevents restore',()=>{
  const {root,file,uploads}=setup();
  try{
    const archive=archiveData(file,uploads,false);assert.equal(archive.entries.some(e=>e.path==='access.json'),false);
    const access=readFileSync(join(root,'access.json'),'utf8');
    const release=acquireBackendLock(root);
    assert.throws(()=>restoreArchive(archive,file,uploads),/Stop the broadcast/);release();
    restoreArchive(archive,file,uploads);assert.equal(readFileSync(join(root,'access.json'),'utf8'),access);
    assert.equal(existsSync(join(root,'.backend.lock')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('tamper, traversal, duplicate entries and malformed stores leave original files unchanged',()=>{
  const {root,file,uploads}=setup();
  try{
    const archive=archiveData(file,uploads),before=readFileSync(file,'utf8');
    const badStore=structuredClone(archive),broken=JSON.parse(before);broken.state.liveGameStats={blueKills:-1};const content=Buffer.from(JSON.stringify(broken));badStore.entries[0].base64=content.toString('base64');badStore.entries[0].sha256=createHash('sha256').update(content).digest('hex');assert.throws(()=>restoreArchive(badStore,file,uploads));assert.equal(readFileSync(file,'utf8'),before);
    assert.equal(existsSync(join(root,'.backend.lock')),false,'a failed restore must release the reservation');
    for(const mutate of [(a:typeof archive)=>a.entries[0].base64='AAAA',(a:typeof archive)=>a.entries[0].path='../outside.json',(a:typeof archive)=>a.entries.push(a.entries[0])]){
      const bad=structuredClone(archive);mutate(bad);assert.throws(()=>validateArchive(bad));assert.equal(readFileSync(file,'utf8'),before);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('restores CN-only heroes, five bans per side and complete post-game observations',()=>{
  const {root,file,uploads,s}=setup();
  const apply=(action:Parameters<Store['apply']>[2])=>s.apply(randomUUID(),s.data.revision,action);
  try{
    apply({type:'settings',settings:{...initialState(),heroPool:'cn',banCount:5}});
    const pool=heroesForPool('cn'),cnOnly=pool.find(hero=>!heroAllowed('global',hero.id))!;
    const picks=[cnOnly,...pool.filter(hero=>hero.id!==cnOnly.id)];let index=0;
    for(const phase of phases('match','blue',5)){
      if(phase.action==='ban')apply({type:'skip_ban',team:phase.team});
      else apply({type:'draft_action',...phase,heroId:picks[index++].id});
    }
    apply({type:'commit_game'});apply({type:'post_game_begin'});
    const report=s.data.state.postGameReports[0],field={value:12345,manual:true,confidence:1,sourcePage:'economy' as const};
    apply({type:'post_game_fields',reportId:report.id,updates:[
      {rowId:report.players[0].rowId,metric:'gold',field},
      {rowId:report.players[0].rowId,metric:'kills',field:{...field,value:8,sourcePage:'record'}},
    ]});
    apply({type:'post_game_team_fields',reportId:report.id,updates:[{side:'blue',metric:'gold',field:{...field,value:54000,sourcePage:'recap'}}]});
    apply({type:'post_game_gold_timeline',reportId:report.id,points:[{timeSeconds:60,blueGold:2000,redGold:2100},{timeSeconds:120,blueGold:4000,redGold:3900}]});
    const archive=archiveData(file,uploads),expected=structuredClone(s.data);
    apply({type:'reset_match'});restoreArchive(archive,file,uploads);
    assert.deepEqual(new Store(file).data,expected);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('invalid post-game fields, team recap and timeline fail before replacing live data',()=>{
  const {root,file,uploads,s}=setup();
  const apply=(action:Parameters<Store['apply']>[2])=>s.apply(randomUUID(),s.data.revision,action);
  try{
    apply({type:'settings',settings:{...initialState(),banCount:0}});
    phases('match','blue',0).forEach((phase,index)=>apply({type:'draft_action',...phase,heroId:heroesForPool('global')[index].id}));
    apply({type:'commit_game'});apply({type:'post_game_begin'});
    const archive=archiveData(file,uploads),before=readFileSync(file,'utf8');
    type Saved=Store['data'];
    for(const mutate of [
      (saved:Saved)=>{saved.state.postGameReports[0].players[0].fields.damageShare={value:101,confidence:1,manual:true,sourcePage:'damage'};},
      (saved:Saved)=>{saved.state.postGameReports[0].players[0].fields.rating={value:101,confidence:1,manual:true,sourcePage:'summary'};},
      (saved:Saved)=>{saved.state.postGameReports[0].players[0].fields.kills={value:1.5,confidence:1,manual:true,sourcePage:'record'};},
      (saved:Saved)=>{saved.state.postGameReports[0].players[0].fields.gold={value:100,confidence:1,manual:true,sourcePage:'economy',evidence:'/unsafe.png'};},
      (saved:Saved)=>{saved.state.postGameReports[0].teamFields={blue:{gold:{value:-1,confidence:1,manual:true,sourcePage:'recap'}}};},
      (saved:Saved)=>{saved.state.postGameReports[0].goldTimeline=[{timeSeconds:120,blueGold:2000,redGold:2100},{timeSeconds:60,blueGold:4000,redGold:3900}];},
    ]){
      const invalid=structuredClone(archive),saved=JSON.parse(before) as Saved;mutate(saved);
      const content=Buffer.from(JSON.stringify(saved)),entry=invalid.entries.find(entry=>entry.path===invalid.matchFile)!;
      entry.base64=content.toString('base64');entry.sha256=createHash('sha256').update(content).digest('hex');
      assert.throws(()=>restoreArchive(invalid,file,uploads));
      assert.equal(readFileSync(file,'utf8'),before);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('backup deduplication accounts for portrait filenames as well as their contents',()=>{
  const {root,file,uploads}=setup();
  try {
    const manager=new RecoveryManager(file,uploads,join(root,'backups'));
    const first=manager.create();assert.ok(first);assert.equal(manager.create(),undefined);
    renameSync(join(uploads,'photo.png'),join(uploads,'renamed.png'));
    const second=manager.create();assert.ok(second);
    const archive=JSON.parse(readFileSync(join(root,'backups',second),'utf8'));
    assert.ok(archive.entries.some((entry:{path:string})=>entry.path==='uploads/player-portraits/renamed.png'));
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('CN five-ban backups restore all settlement pages, grades, exact gold and economy curves',()=>{
  const {root,file,uploads,s}=setup();
  try {
    const apply=(action:Action)=>s.apply(randomUUID(),s.data.revision,action);
    apply({type:'settings',settings:{...s.data.state,heroPool:'cn',banCount:5}});
    const pool=heroesForPool('cn');let selected=0;
    for(const phase of phases('match','blue',5))apply(phase.action==='ban'?{type:'skip_ban',team:phase.team}:{type:'draft_action',...phase,heroId:pool[selected++].id});
    apply({type:'commit_game'});apply({type:'post_game_begin'});
    const reportId=s.data.state.activePostGameReportId!,rowId=s.data.state.postGameReports[0].players[0].rowId;
    const updates:Extract<Action,{type:'post_game_fields'}>['updates']=[
      {rowId,metric:'gold',field:{value:7589,resolution:1,sourcePage:'summary',confidence:.96,manual:false}},
      {rowId,metric:'totalDamage',field:{value:45400,resolution:100,sourcePage:'overview',confidence:.96,manual:false}},
      {rowId,metric:'damageConversion',field:{value:.8,sourcePage:'damage',confidence:.96,manual:false}},
      {rowId,metric:'damagePerDeath',field:{value:8000,sourcePage:'survival',confidence:.96,manual:false}},
      {rowId,metric:'jungleGold',field:{value:2500,sourcePage:'economy',confidence:.96,manual:false}},
      {rowId,metric:'kills',field:{value:4,sourcePage:'record',confidence:.96,manual:false}},
      {rowId,metric:'control',field:{value:10,sourcePage:'team',confidence:.96,manual:false}},
    ];
    apply({type:'post_game_fields',reportId,updates,grades:[{rowId,field:{value:'A+',sourcePage:'summary',confidence:1,manual:true}}]});
    apply({type:'post_game_team_fields',reportId,updates:[{side:'blue',metric:'gold',field:{value:41900,sourcePage:'recap',confidence:.96,manual:false}}],goldDifference:{source:'settlement',confidence:.96,maxDifference:800,partial:true,durationSeconds:180,points:[{timeSeconds:0,difference:0},{timeSeconds:60,difference:400},{timeSeconds:120,difference:-200}]}});
    apply({type:'post_game_mvp_art_scale',reportId,scale:1.1});
    const before=structuredClone(s.data),archive=archiveData(file,uploads,false);
    restoreArchive(archive,file,uploads);
    const restored=new Store(file);
    assert.deepEqual(restored.data,before);
    assert.equal(restored.data.state.currentPhase,20);
    assert.equal(restored.data.state.postGameReports[0].players[0].fields.gold?.value,7589);
    assert.equal(restored.data.state.postGameReports[0].players[0].grade?.value,'A+');
    assert.equal(restored.data.state.postGameReports[0].goldDifference?.durationSeconds,180,'the complete time axis must survive partial-curve persistence and restore');
    const rewrite=(change:(data:typeof before)=>void)=>{
      const modified=structuredClone(archive),data=structuredClone(before);change(data);
      const content=Buffer.from(JSON.stringify(data)),entry=modified.entries.find(item=>item.path===modified.matchFile)!;
      entry.base64=content.toString('base64');entry.sha256=createHash('sha256').update(content).digest('hex');return modified;
    };
    for(const change of [
      (data:typeof before)=>{data.state.postGameReports[0].players[0].fields.gold!.resolution=7;},
      (data:typeof before)=>{data.state.postGameReports[0].players[0].grade!.value='9.8' as 'A+';},
      (data:typeof before)=>{data.state.postGameReports[0].teamFields!.blue!.gold!.value=-1;},
      (data:typeof before)=>{data.state.postGameReports[0].goldDifference!.points[1].timeSeconds=0;},
      (data:typeof before)=>{data.state.bluePlayerSlotOrder=[0,0,1,2,3];},
      (data:typeof before)=>{data.state.postGameReports[0].players[1].rosterIndex=0;},
    ]) {
      assert.throws(()=>restoreArchive(rewrite(change),file,uploads));
      assert.deepEqual(new Store(file).data,before,'invalid restoration must leave the saved match intact');
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
