export interface NeutralObjective { id:string; name:string; icon:string; blue:number; red:number }
import type { MatchState } from './types.js';
import { consistentLiveValue, liveCaptureKeys, parseLiveNumber, type LiveCandidate, type LiveCaptureKey } from './gameCapture.js';
export interface LiveFieldSource { source:'manual'|'ocr'; capturedAt:number; confidence:number }
export interface LiveHudSample { capturedAt:number; candidates:LiveCandidate[] }
export interface LiveGameStats { blueKills:number; redKills:number; blueTowers:number; redTowers:number; blueGold?:number; redGold?:number; gameTimeSeconds?:number; sources?:Partial<Record<LiveCaptureKey,LiveFieldSource>>; neutralObjectives:NeutralObjective[]; density:'compact'|'full' }
export const liveGameContext=(state:MatchState)=>JSON.stringify([state.draftGameNumber??state.gameNumber,state.blueTeam.id,state.redTeam.id,state.committedGameId,state.bluePicks,state.redPicks]);
export function trustedLiveUpdates(stats:LiveGameStats,previous:LiveHudSample,sample:LiveHudSample){
  const updates:Partial<Record<LiveCaptureKey,number>>={};
  const elapsed=sample.capturedAt-previous.capturedAt;
  const clock=sample.candidates.find(c=>c.key==='gameTimeSeconds'),oldClock=previous.candidates.find(c=>c.key==='gameTimeSeconds');
  if(clock?.value==null||oldClock?.value==null||!Number.isInteger(clock.value)||!Number.isInteger(oldClock.value)||oldClock.value<0||clock.value>7200||clock.confidence<.85||oldClock.confidence<.85||!consistentLiveValue('gameTimeSeconds',oldClock.value,clock.value,elapsed))return updates;
  for(const key of liveCaptureKeys){
    const incoming=sample.candidates.find(c=>c.key===key),prior=previous.candidates.find(c=>c.key===key),source=stats.sources?.[key];
    if(incoming?.value==null||prior?.value==null||incoming.confidence<.85||prior.confidence<.85||source?.source==='manual')continue;
    const encoded=(value:number)=>key==='gameTimeSeconds'?`${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`:String(value);
    if(parseLiveNumber(encoded(incoming.value),key)!==incoming.value||parseLiveNumber(encoded(prior.value),key)!==prior.value)continue;
    if(!consistentLiveValue(key,prior.value,incoming.value,elapsed))continue;
    if(source){
      const since=sample.capturedAt-source.capturedAt,current=stats[key]??0;
      if(since<=0||since>30000||incoming.value<current)continue;
      const maxDelta=key.endsWith('Gold')?Math.max(1500,since*.3):key==='gameTimeSeconds'?Math.ceil(since/1000)+2:key.endsWith('Towers')?3:5;
      if(incoming.value-current>maxDelta)continue;
    }
    updates[key]=incoming.value;
  }
  return updates;
}
export const initialLiveGameStats=():LiveGameStats=>({blueKills:0,redKills:0,blueTowers:0,redTowers:0,neutralObjectives:[],density:'full'});
export function nextLiveGameStats(previous:LiveGameStats):LiveGameStats {return {...initialLiveGameStats(),density:previous.density,neutralObjectives:previous.neutralObjectives.map(item=>({...item,blue:0,red:0}))};}
