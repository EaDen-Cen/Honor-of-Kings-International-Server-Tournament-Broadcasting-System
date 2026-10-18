import { allPoolHeroes, heroAllowed } from '../src/shared/heroPool.js';
import { phases, type Side } from '../src/shared/types.js';
import { normalizeState } from '../src/shared/draftRules.js';
import { validPlayerSlotOrder } from '../src/shared/playerSlots.js';
import { postGameMetrics, postGameTeamMetrics, type PostGameMetric, type PostGameTeamMetric } from '../src/shared/postGame.js';
import { validatePostGameGrade, validatePostGameCurve } from './postGameValidation.js';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, renameSync, rmSync, statSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store, portraitURL } from './store.js';
import { TeamPresetStore } from './teamPresets.js';
import { validateAccessData } from './access.js';

interface Entry { path:string; base64:string; sha256:string }
export interface RecoveryArchive { format:'hok-backup-v1'|'hok-match-v1'; createdAt:string; matchFile:string; entries:Entry[] }
const hash=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
const allowed=(path:string,matchFile:string,backup:boolean)=>path===matchFile||path==='team-presets.json'||(backup&&path==='access.json')||/^uploads\/player-portraits\/[a-zA-Z0-9-]+\.(png|jpg|jpeg|webp)$/.test(path);
export function archiveData(dataFile:string,uploadDirectory:string,backup=true):RecoveryArchive {
  const root=dirname(resolve(dataFile)), matchFile=relative(root,resolve(dataFile));
  const paths=[matchFile,'team-presets.json',...(backup?['access.json']:[])].filter(path=>existsSync(resolve(root,path)));
  if(!paths.includes(matchFile))throw new Error('No saved match yet');
  const entries:Entry[]=paths.map(path=>{const content=readFileSync(resolve(root,path));return {path,base64:content.toString('base64'),sha256:hash(content)};});
  if(existsSync(uploadDirectory))for(const file of readdirSync(uploadDirectory)) {
    const path='uploads/player-portraits/'+file;
    if(!allowed(path,matchFile,backup)||!statSync(resolve(uploadDirectory,file)).isFile())continue;
    const content=readFileSync(resolve(uploadDirectory,file));entries.push({path,base64:content.toString('base64'),sha256:hash(content)});
  }
  return {format:backup?'hok-backup-v1':'hok-match-v1',createdAt:new Date().toISOString(),matchFile,entries};
}
export function validateArchive(input:unknown):RecoveryArchive {
  const archive=input as RecoveryArchive;
  if(!archive||!['hok-backup-v1','hok-match-v1'].includes(archive.format)||typeof archive.createdAt!=='string'||!Array.isArray(archive.entries)||archive.entries.length>1000||!/^[-a-zA-Z0-9_]+\.json$/.test(archive.matchFile))throw new Error('Invalid recovery archive');
  const names=new Set<string>();let size=0;
  for(const entry of archive.entries){
    if(!entry||typeof entry.path!=='string'||!allowed(entry.path,archive.matchFile,archive.format==='hok-backup-v1')||names.has(entry.path)||typeof entry.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.base64)||entry.base64.length%4!==0)throw new Error('Unsafe or duplicate archive entry');
    const content=Buffer.from(entry.base64,'base64');size+=content.length;
    if(size>128*1024*1024||hash(content)!==entry.sha256)throw new Error('Archive checksum or size is invalid');
    names.add(entry.path);
  }
  if(!names.has(archive.matchFile))throw new Error('Archive is missing match data');
  // Validate the restored stores in an isolated staging directory before touching live files.
  return archive;
}
function validateStores(archive:RecoveryArchive,stage:string){
  const file=resolve(stage,archive.matchFile);
  const raw=JSON.parse(readFileSync(file,'utf8'));
  if(![1,2].includes(raw.version)||!raw.state||!Array.isArray(raw.events)||!Array.isArray(raw.history)||!Array.isArray(raw.ids)||!Number.isSafeInteger(raw.revision)||raw.revision<0||!Number.isInteger(raw.delay)||raw.delay<0||raw.delay>3600)throw new Error('Invalid saved match');
  for(const state of [raw.state,...raw.history,...raw.events.map((event:{resultingState:unknown})=>event?.resultingState)]){
    if(!state||typeof state!=='object')throw new Error('Invalid saved match state');
    for(const side of ['blue','red'] as const)if(state[`${side}PlayerSlotOrder`]!==undefined&&!validPlayerSlotOrder(state[`${side}PlayerSlotOrder`]))throw new Error('Invalid player slot order');
  }
  // Store is the authoritative schema upgrader. Validate the migrated v2 view so
  // recovery can safely import both pre-release-order v1 archives and new v2 ones.
  const data=new Store(file).data;
  for(const state of [data.state,...data.history,...data.events.map(event=>event.resultingState)]){
    if(!state||!Array.isArray(state.bluePicks)||!Array.isArray(state.redPicks)||!Array.isArray(state.draftHistory)||!state.blueTeam||!state.redTeam)throw new Error('Invalid saved match state');
    // Reuse all settings validation, including safe asset URLs, roles, score bounds and IDs.
    const normalized=normalizeState(state),verifier=new Store();verifier.apply(randomUUID(),0,{type:'settings',settings:normalized});
    verifier.apply(randomUUID(),verifier.data.revision,{type:'live_game_stats',stats:normalized.liveGameStats});
    if(!Number.isInteger(state.currentPhase)||state.currentPhase<0||state.currentPhase>phases(normalized.draftMode,normalized.firstPickSide,normalized.banCount).length||typeof state.draftComplete!=='boolean')throw new Error('Invalid draft progress');
    for(const side of ['blue','red'] as const){
      const picks=state[`${side}Picks`],bans=state[`${side}Bans`],assignments=normalized[`${side}Assignments`];
      if(!Array.isArray(bans)||picks.length>5||bans.length>normalized.banCount||new Set(picks).size!==picks.length||[...picks,...bans.filter((value):value is number=>value!==null)].some(id=>!heroAllowed(normalized.heroPool,id)))throw new Error('Invalid draft heroes');
      if(assignments.some(id=>id!==null&&!picks.includes(id)))throw new Error('Invalid hero assignments');
      if(state[`${side}PlayerSlotOrder`]!==undefined&&!validPlayerSlotOrder(state[`${side}PlayerSlotOrder`]))throw new Error('Invalid player slot order');
    }
    for(const record of normalized.draftHistory){
      if(!record||typeof record.id!=='string'||!Number.isInteger(record.gameNumber)||record.gameNumber<1||record.gameNumber>5)throw new Error('Invalid draft history');
      const check=new Store();check.apply(randomUUID(),0,{type:'settings',settings:{...normalized,blueScore:0,redScore:0,blueTeam:record.blueTeam,redTeam:record.redTeam}});
      for(const side of ['blue','red'] as const){
        const picks=record[`${side}Picks`],assignments=record[`${side}Assignments`];
        if(!Array.isArray(picks)||picks.length!==5||!Array.isArray(assignments)||assignments.length!==5||new Set(assignments).size!==5||assignments.some(heroId=>!picks.includes(heroId)||!heroAllowed(record.heroPool,heroId)))throw new Error('Invalid committed lineup');
      }
    }
    if(!Array.isArray(normalized.postGameReports)||normalized.postGameReports.length>20||new Set(normalized.postGameReports.map(report=>report.id)).size!==normalized.postGameReports.length)throw new Error('Invalid post-game reports');
    if(normalized.activePostGameReportId!==null&&!normalized.postGameReports.some(report=>report.id===normalized.activePostGameReportId))throw new Error('Invalid active report');
    for(const report of normalized.postGameReports){
      if(!report||typeof report.id!=='string'||report.players?.length!==10||new Set(report.players.map(player=>player.rowId)).size!==10||!['BO1','BO3','BO5'].includes(report.seriesFormat)||!Number.isInteger(report.gameNumber)||report.gameNumber<1||report.gameNumber>5||typeof report.stage!=='string')throw new Error('Invalid post-game report');
      // Run stored observations through the same validators as live updates. This
      // keeps imports compatible with every supported page and field constraint.
      const fieldVerifier=new Store();fieldVerifier.data.state.postGameReports=[structuredClone(report)];
      for(const player of report.players){
        if(typeof player.rowId!=='string'||!player.rowId||typeof player.playerId!=='string'||!['blue','red'].includes(player.side)||!allPoolHeroes.some(hero=>hero.id===player.heroId)||!Number.isInteger(player.slot)||player.slot<0||player.slot>4||!Number.isInteger(player.rosterIndex)||player.rosterIndex<0||player.rosterIndex>4||!['clash','jungle','mid','farm','roam'].includes(player.role)||!player.fields||typeof player.fields!=='object'||Array.isArray(player.fields)||Object.keys(player.fields).some(key=>!postGameMetrics.includes(key as PostGameMetric)))throw new Error('Invalid post-game player');
        portraitURL(player.portrait);
        const updates=Object.entries(player.fields).map(([metric,field])=>({rowId:player.rowId,metric:metric as PostGameMetric,field:field!}));
        if(updates.length)fieldVerifier.apply(randomUUID(),fieldVerifier.data.revision,{type:'post_game_fields',reportId:report.id,updates});
        if(player.grade!==undefined)validatePostGameGrade(player.grade);
      }
      if(report.teamFields!==undefined){
        if(!report.teamFields||typeof report.teamFields!=='object'||Array.isArray(report.teamFields)||Object.keys(report.teamFields).some(side=>!['blue','red'].includes(side)))throw new Error('Invalid post-game team fields');
        for(const [side,fields] of Object.entries(report.teamFields)){
          if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(metric=>!postGameTeamMetrics.includes(metric as PostGameTeamMetric)))throw new Error('Invalid post-game team fields');
          const updates=Object.entries(fields).map(([metric,field])=>({side:side as Side,metric:metric as PostGameTeamMetric,field:field!}));
          if(updates.length)fieldVerifier.apply(randomUUID(),fieldVerifier.data.revision,{type:'post_game_team_fields',reportId:report.id,updates});
        }
      }
      if(report.goldTimeline!==undefined)fieldVerifier.apply(randomUUID(),fieldVerifier.data.revision,{type:'post_game_gold_timeline',reportId:report.id,points:report.goldTimeline});
      for(const side of ['blue','red'] as const){
        const players=report.players.filter(player=>player.side===side);
        if(players.length!==5||new Set(players.map(player=>player.slot)).size!==5||new Set(players.map(player=>player.rosterIndex)).size!==5)throw new Error('Invalid report lineup');
      }
      if(report.selectedMvpRowId===null?report.selectedMvpPlayerId!==null:!report.players.some(player=>player.rowId===report.selectedMvpRowId&&player.playerId===report.selectedMvpPlayerId))throw new Error('Invalid MVP identity');
      if(report.mvpArtScale!==undefined&&(!Number.isFinite(report.mvpArtScale)||report.mvpArtScale<1||report.mvpArtScale>2))throw new Error('Invalid MVP image scale');
      if(report.goldDifference!==undefined)validatePostGameCurve(report.goldDifference);
    }

  }
  if(existsSync(resolve(stage,'team-presets.json')))new TeamPresetStore(resolve(stage,'team-presets.json'));
  if(existsSync(resolve(stage,'access.json'))){
    const access=JSON.parse(readFileSync(resolve(stage,'access.json'),'utf8'));
    validateAccessData(access);
  }
}
export function assertBackendStopped(root:string){
  const lock=resolve(root,'.backend.lock');
  if(!existsSync(lock))return;
  const pid=Number(readFileSync(lock,'utf8'));
  if(!Number.isSafeInteger(pid)||pid<1)throw new Error('Invalid backend lock; check the running server');
  try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){rmSync(lock);return;}throw error;}
  throw new Error('Stop the broadcast backend before restoring or importing');
}
export function acquireBackendLock(root:string){
  mkdirSync(root,{recursive:true});assertBackendStopped(root);
  const file=resolve(root,'.backend.lock');const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,String(process.pid));}finally{closeSync(fd);}
  return()=>{try{if(readFileSync(file,'utf8')===String(process.pid))rmSync(file);}catch{/* lock may already be removed */}};
}
export function restoreArchive(input:unknown,dataFile:string,uploadDirectory:string){
  const archive=validateArchive(input), root=dirname(resolve(dataFile));
  // Reserve the backend lock throughout validation and replacement, otherwise
  // a server can start between the initial check and the final file rename.
  const release=acquireBackendLock(root);
  const stage=resolve(root,`.restore-${randomUUID()}`);
  const replaced:Array<{target:string;old:string;existed:boolean}>=[];
  try {
    mkdirSync(stage);
    for(const entry of archive.entries){const target=resolve(stage,entry.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,Buffer.from(entry.base64,'base64'),{mode:0o600});}
    validateStores(archive,stage);
    for(const entry of archive.entries){
      const target=entry.path===archive.matchFile?resolve(dataFile):entry.path.startsWith('uploads/')?resolve(uploadDirectory,entry.path.split('/').at(-1)!):resolve(root,entry.path);
      mkdirSync(dirname(target),{recursive:true});const old=target+'.recovery-old-'+randomUUID(),existed=existsSync(target);
      if(existed)renameSync(target,old);
      replaced.push({target,old,existed});renameSync(resolve(stage,entry.path),target);
    }
    for(const item of replaced)if(item.existed)try{rmSync(item.old);}catch{/* retain rollback file if cleanup fails */}
  }catch(error){
    for(const item of replaced.reverse()){rmSync(item.target,{force:true});if(item.existed&&existsSync(item.old))renameSync(item.old,item.target);}
    throw error;
  }finally{try{rmSync(stage,{recursive:true,force:true});}finally{release();}}
}
export class RecoveryManager {
  private lastSignature='';
  lastBackup='';error='';
  constructor(private dataFile:string,private uploadDirectory:string,readonly directory=resolve(dirname(dataFile),'backups'),private keep=20){}
  list(){if(!existsSync(this.directory))return [];return readdirSync(this.directory).filter(file=>/^backup-[\dT-]+-[a-f0-9-]+\.json$/.test(file)).sort().reverse();}
  create(force=false){
    const archive=archiveData(this.dataFile,this.uploadDirectory),signature=archive.entries.map(entry=>`${entry.path}:${entry.sha256}`).sort().join('|');
    if(!force&&signature===this.lastSignature)return;
    const name=`backup-${archive.createdAt.replace(/[:.Z]/g,'-')}-${randomUUID()}.json`;
    mkdirSync(this.directory,{recursive:true,mode:0o700});const file=resolve(this.directory,name);
    writeFileSync(file+'.tmp',JSON.stringify(archive),{mode:0o600});renameSync(file+'.tmp',file);
    this.lastSignature=signature;this.lastBackup=archive.createdAt;this.error='';
    for(const old of this.list().slice(this.keep))rmSync(resolve(this.directory,old));
    return name;
  }
  automatic(){if(!existsSync(this.dataFile))return;try{this.create();}catch(error){this.error=error instanceof Error?error.message:'Backup failed';}}
}
