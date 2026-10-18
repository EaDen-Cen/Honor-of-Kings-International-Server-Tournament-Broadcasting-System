import type { PostGameMetric, PostGamePage } from './postGame.js';

export interface CaptureRect { x:number; y:number; width:number; height:number }
export const fullGameRect:CaptureRect={x:0,y:0,width:1,height:1};
export const settlementTabPages:PostGamePage[]=['overview','damage','survival','economy','record','team','recap'];
export const settlementPages:PostGamePage[]=['summary',...settlementTabPages];
export function settlementPageLabel(page:PostGamePage,zh:boolean){return ({summary:['结算总览','Settlement summary'],overview:['数据','Data'],damage:['输出','Damage'],survival:['生存','Survival'],economy:['发育','Economy'],record:['战绩','KDA'],team:['团队','Team'],recap:['对局汇总','Game recap']} as const)[page][zh?0:1];}
const rect=(x:number,y:number,width:number,height:number):CaptureRect=>({x:x/1920,y:y/1080,width:width/1920,height:height/1080});
/** Coordinates are relative to game content, excluding emulator/window chrome. */
export function settlementNameRect(row:number,page?:PostGamePage):CaptureRect {
  return rect((page==='summary'?382:300)+(row>=5?960:0),210+(row%5)*130,page==='summary'?207:635,35);
}
export interface SettlementColumn { metric:PostGameMetric; region:CaptureRect }
export function settlementColumns(page:PostGamePage,row:number):SettlementColumn[]{
  const side=row>=5?960:0,y=(row%5)*130;
  const value=(metric:PostGameMetric,x:number,width:number)=>({metric,region:rect(side+x,250+y,width,34)});
  const percent=(metric:PostGameMetric,right:number)=>({metric,region:rect(side+right-90,285+y,90,29)});
  switch(page){
  case 'summary':return (['kills','deaths','assists','gold'] as const).map((metric,index)=>({metric,region:rect((row<5?[592,656,716,760]:[1540,1601,1663,1704])[index],210+y,index===3?88:30,34)}));
  case 'recap':return [];
  case 'overview':return [value('totalDamage',302,148),percent('damageShare',452),value('damageTaken',465,148),percent('damageTakenShare',615),value('gold',628,148),percent('goldShare',778),percent('participation',938)];
  case 'damage':return [value('totalDamage',302,305),percent('damageShare',615),value('damageConversion',628,305)];
  case 'survival':return [value('damageTaken',302,305),percent('damageTakenShare',615),value('damagePerDeath',628,305)];
  case 'economy':return [value('gold',302,204),percent('goldShare',506),value('jungleGold',520,204),percent('jungleGoldShare',724),value('lastHits',736,198),percent('lastHitsShare',938)];
  case 'record':return [value('kills',302,204),percent('killsShare',506),value('deaths',520,204),percent('deathsShare',724),value('assists',736,198),percent('assistsShare',938)];
  case 'team':return [percent('participation',452),value('control',465,148),percent('controlShare',615),value('healing',628,148),percent('healingShare',778),value('towerDamage',790,148),percent('towerDamageShare',938)];
  }
}
// White active tab labels differ from the dim blue inactive labels in supplied UI.
export const settlementTabRects=settlementTabPages.map((_,i)=>rect(395+i*188,990,70,40));
export const settlementGradeRect=(row:number)=>rect(160+(row>=5?960:0),230+(row%5)*130,128,77);
export function settlementPageMetrics(page:PostGamePage):PostGameMetric[]{return settlementColumns(page,0).map(column=>column.metric);}
export function recapRegions(side:'left'|'right'){
  const offset=side==='left'?0:856;
  return {kda:rect(482+offset,224,145,40),gold:rect(482+offset,285,145,40),resources:Array.from({length:6},(_,index)=>rect(193+(side==='left'?0:885)+index*118,480,47,42))};
}
export const liveCaptureKeys=['blueKills','redKills','blueGold','redGold','blueTowers','redTowers','gameTimeSeconds'] as const;
export type LiveCaptureKey=typeof liveCaptureKeys[number];
export const liveCaptureLabel=(key:LiveCaptureKey,zh:boolean)=>({blueKills:['蓝方人头','Blue kills'],redKills:['红方人头','Red kills'],blueGold:['蓝方经济','Blue gold'],redGold:['红方经济','Red gold'],blueTowers:['蓝方推塔','Blue towers'],redTowers:['红方推塔','Red towers'],gameTimeSeconds:['游戏时间（秒）','Game time (seconds)']}[key][zh?0:1]);
export const liveCaptureRects:Record<LiveCaptureKey,CaptureRect>={
  blueKills:rect(884,22,39,43),redKills:rect(999,22,39,43),
  blueGold:rect(726,19,70,38),redGold:rect(1145,19,70,38),
  blueTowers:rect(650,19,26,38),redTowers:rect(1274,19,26,38),
  gameTimeSeconds:rect(931,1,59,27),
};
/** Full, non-overlapping seven-field profile. Unknown game UI layouts must be
 * calibrated in Control before enabling automatic publication. */
export function validLiveCaptureRects(value:unknown):value is Record<LiveCaptureKey,CaptureRect> {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const regions=value as Record<string,unknown>;
  if(Object.keys(regions).length!==liveCaptureKeys.length)return false;
  if(!liveCaptureKeys.every(key=>validCaptureRect(regions[key])))return false;
  for(const key of liveCaptureKeys){
    const region=regions[key] as CaptureRect;
    if(region.width<.005||region.height<.008||region.width>.24||region.height>.18)return false;
  }
  for(let i=0;i<liveCaptureKeys.length;i++){
    const a=regions[liveCaptureKeys[i]] as CaptureRect;
    for(let j=i+1;j<liveCaptureKeys.length;j++){
      const b=regions[liveCaptureKeys[j]] as CaptureRect;
      const overlapX=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
      const overlapY=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
      if(overlapX*overlapY>Math.min(a.width*a.height,b.width*b.height)*.3)return false;
    }
  }
  return true;
}
/** Compare server-side ROI layouts rather than mixing two reads from different crops. */
export function liveCaptureProfile(regions:Record<LiveCaptureKey,CaptureRect>):string {
  return liveCaptureKeys.map(key=>{const r=regions[key];return [r.x,r.y,r.width,r.height].map(v=>v.toFixed(5)).join(',');}).join('|');
}
export function validCaptureRect(value:unknown):value is CaptureRect {
  if(!value||typeof value!=='object')return false;
  const r=value as CaptureRect;
  return [r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n))&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1.000001&&r.y+r.height<=1.000001;
}
export function pixelRect(region:CaptureRect,width:number,height:number){
  const left=Math.min(width-1,Math.max(0,Math.round(region.x*width))),top=Math.min(height-1,Math.max(0,Math.round(region.y*height)));
  return {left,top,width:Math.max(1,Math.min(width-left,Math.round(region.width*width))),height:Math.max(1,Math.min(height-top,Math.round(region.height*height)))};
}
export function parseLiveNumber(text:string,key:LiveCaptureKey):number|null {
  const value=text.normalize('NFKC').trim();
  if(key==='gameTimeSeconds'){
    const match=/^(\d{1,3}):([0-5]\d)$/.exec(value);
    if(!match)return null;
    const seconds=Number(match[1])*60+Number(match[2]);return seconds<=7200?seconds:null;
  }
  if(key.endsWith('Gold')){
    const match=/^(\d+(?:\.\d+)?)\s*([kK万]?)$/.exec(value);
    if(!match)return null;
    const gold=Number(match[1])*(match[2].toLowerCase()==='k'?1000:match[2]==='万'?10000:1);
    return Number.isInteger(gold)&&gold>=0&&gold<=1000000?gold:null;
  }
  return /^\d{1,3}$/.test(value)&&Number(value)<=(key.endsWith('Towers')?11:200)?Number(value):null;
}
export interface NumericCandidate { value:number|null; confidence:number; text:string }
export interface LiveCandidate extends NumericCandidate { key:LiveCaptureKey }
/** Two independent reads must agree; animated gold/time may advance within bounds. */
export function consistentLiveValue(key:LiveCaptureKey,previous:number,next:number,elapsedMs:number):boolean {
  if(elapsedMs<300||elapsedMs>15000||next<previous)return false;
  if(key==='gameTimeSeconds')return next-previous<=Math.ceil(elapsedMs/1000)+2;
  if(key.endsWith('Gold'))return next-previous<=Math.max(500,elapsedMs*.3);
  return next===previous;
}
