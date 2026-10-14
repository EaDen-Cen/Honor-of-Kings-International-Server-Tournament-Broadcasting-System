import type { MatchState, PlayerRole, Side } from './types.js';
import type { GoldTimelinePoint } from './postGameTimeline.js';
export const postGameMetrics=['kills','deaths','assists','rating','damageShare','gold','totalDamage','participation','healing','damageTaken','damageConversion','damageTakenShare','damagePerDeath','goldShare','jungleGold','jungleGoldShare','lastHits','lastHitsShare','control','controlShare','healingShare','towerDamage','towerDamageShare','killsShare','deathsShare','assistsShare'] as const;
export type PostGameMetric=typeof postGameMetrics[number];
export type PostGamePage='overview'|'survival'|'damage'|'team'|'economy'|'record'|'recap';
export const postGameTeamMetrics=['kills','deaths','assists','gold','towers','resource1','resource2','resource3','resource4','resource5'] as const;
export type PostGameTeamMetric=typeof postGameTeamMetrics[number];
export const postGameTeamMetricLabel=(metric:PostGameTeamMetric,zh:boolean)=>metric.startsWith('resource')?`${zh?'资源槽':'Resource slot '}${metric.slice(-1)}`:postGameMetrics.includes(metric as PostGameMetric)?postGameMetricLabel(metric as PostGameMetric,zh):(zh?'推塔':'Towers');
export const postGamePercentMetrics:readonly PostGameMetric[]=['damageShare','participation','damageTakenShare','goldShare','jungleGoldShare','lastHitsShare','controlShare','healingShare','towerDamageShare','killsShare','deathsShare','assistsShare'];
export const postGameDecimalMetrics:readonly PostGameMetric[]=['rating','damageConversion',...postGamePercentMetrics];
export const postGameUnitMetrics:readonly PostGameMetric[]=['gold','totalDamage','healing','damageTaken','damagePerDeath','jungleGold','towerDamage'];
export interface PostGameField { value:number; sourcePage:PostGamePage; confidence:number; manual:boolean; evidence?:string; capturedAt?:number }
export interface PostGamePlayer { rowId:string; playerId:string; side:Side; slot:number; rosterIndex:number; teamName:string; portrait:string; role:PlayerRole; heroId:number; fields:Partial<Record<PostGameMetric,PostGameField>> }
export interface PostGameReport { id:string; gameNumber:number; seriesFormat:MatchState['seriesFormat']; stage:string; players:PostGamePlayer[]; teamFields?:Partial<Record<Side,Partial<Record<PostGameTeamMetric,PostGameField>>>>; goldTimeline?:GoldTimelinePoint[]; selectedMvpPlayerId:string|null; selectedMvpRowId:string|null }
export const postGameMetricLabel=(key:PostGameMetric,zh:boolean)=>({kills:['击杀','Kills'],deaths:['死亡','Deaths'],assists:['助攻','Assists'],rating:['游戏评分','Rating'],damageShare:['输出占比','Damage share'],gold:['经济','Gold'],totalDamage:['总输出','Total damage'],participation:['参团率','Participation'],healing:['治疗','Healing'],damageTaken:['承受伤害','Damage taken'],damageConversion:['伤害转化比','Damage conversion'],damageTakenShare:['承伤占比','Damage taken share'],damagePerDeath:['每死承伤','Damage per death'],goldShare:['经济占比','Gold share'],jungleGold:['野怪经济','Jungle gold'],jungleGoldShare:['野怪经济占比','Jungle gold share'],lastHits:['补刀数','Last hits'],lastHitsShare:['补刀占比','Last hits share'],control:['控制效果','Crowd control'],controlShare:['控制占比','Control share'],healingShare:['治疗占比','Healing share'],towerDamage:['对塔伤害','Tower damage'],towerDamageShare:['对塔伤害占比','Tower damage share'],killsShare:['击杀占比','Kills share'],deathsShare:['死亡占比','Deaths share'],assistsShare:['助攻占比','Assists share']}[key][zh?0:1]);
export function reliableField(field:PostGameField|undefined){return !!field&&(field.manual||field.confidence>=.85);}
/** Reject ambiguous OCR rather than guessing missing digits or units. */
export function parsePostGameNumber(text:string,metric:PostGameMetric):number|null {
  const normalized=text.normalize('NFKC').trim();
  const match=/^(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kK万%]?)$/.exec(normalized);
  if(!match)return null;
  const percent=postGamePercentMetrics.includes(metric),unit=match[2];
  if(unit==='%'&&!percent||unit&&unit!=='%'&&!postGameUnitMetrics.includes(metric))return null;
  const value=Number(match[1].replace(/,/g,''))*(unit.toLowerCase()==='k'?1000:unit==='万'?10000:1);
  if(!Number.isFinite(value)||value<0||value>(percent?100:1e9))return null;
  if(!postGameDecimalMetrics.includes(metric)&&!Number.isInteger(value))return null;
  return value;
}
/** OCR may improve a draft, but conflicting trusted values need manual review. */
export function canMergePostGameField(current:PostGameField|undefined,incoming:PostGameField):boolean {
  if(incoming.manual||!current)return true;
  if(current.manual)return false;
  if(reliableField(current)&&current.value!==incoming.value)return false;
  return incoming.confidence>=current.confidence;
}
/** Display priorities only: this never selects or scores MVP candidates. */
export function highlightStats(player:PostGamePlayer){
  const priority:PostGameMetric[]=player.role==='roam'?['participation','healing','damageTaken','gold','totalDamage','damageShare']:player.role==='clash'?['damageTaken','totalDamage','participation','gold','damageShare','healing']:['damageShare','gold','totalDamage','participation','damageTaken','healing'];
  return priority.filter(key=>reliableField(player.fields[key])).slice(0,3).map(key=>({key,field:player.fields[key]!}));
}
