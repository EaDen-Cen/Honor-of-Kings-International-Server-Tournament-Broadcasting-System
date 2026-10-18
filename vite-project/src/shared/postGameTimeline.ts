/** Genuine, time-stamped economy observations; no reconstruction from final totals. */
export interface GoldTimelinePoint { timeSeconds:number; blueGold:number; redGold:number }
export interface GoldDifferencePoint { timeSeconds:number; difference:number }
export const formatEconomyTime=(seconds:number)=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
export interface GoldDifferenceTimeline { points:GoldDifferencePoint[]; source:'settlement'|'manual'; confidence:number; maxDifference:number; evidence?:string; capturedAt?:number; partial?:boolean; durationSeconds?:number }
export function validGoldDifferencePoints(points:unknown):points is GoldDifferencePoint[]{
  if(!Array.isArray(points)||points.length<2||points.length>240)return false;
  let previous=-1;
  for(const point of points){
    if(!point||typeof point!=='object'||!Number.isInteger(point.timeSeconds)||point.timeSeconds<0||point.timeSeconds>7200||point.timeSeconds<=previous||!Number.isInteger(point.difference)||Math.abs(point.difference)>1000000)return false;
    previous=point.timeSeconds;
  }
  return true;
}
export function validGoldDifferenceTimeline(value:unknown):value is GoldDifferenceTimeline {
  if(!value||typeof value!=='object')return false;
  const curve=value as GoldDifferenceTimeline;
  return (curve.partial===undefined||typeof curve.partial==='boolean')&&validGoldDifferencePoints(curve.points)&&(curve.durationSeconds===undefined||Number.isInteger(curve.durationSeconds)&&curve.durationSeconds>=curve.points.at(-1)!.timeSeconds&&curve.durationSeconds<=7200)&&['settlement','manual'].includes(curve.source)&&Number.isFinite(curve.confidence)&&curve.confidence>=.85&&curve.confidence<=1&&Number.isFinite(curve.maxDifference)&&curve.maxDifference>0&&curve.maxDifference<=1000000&&curve.points.every(p=>Math.abs(p.difference)<=curve.maxDifference);
}
export function reportGoldDifference(report:{goldDifference?:GoldDifferenceTimeline;goldTimeline?:GoldTimelinePoint[]}):GoldDifferencePoint[]{
  return validGoldDifferenceTimeline(report.goldDifference)?report.goldDifference.points:validGoldTimeline(report.goldTimeline)?report.goldTimeline.map(p=>({timeSeconds:p.timeSeconds,difference:p.blueGold-p.redGold})):[];
}
const goldValue=(text:string)=>{
  const match=/^(\d+(?:\.\d+)?)\s*([kK万]?)$/.exec(text.trim().normalize('NFKC'));
  if(!match)return null;
  const value=Number(match[1])*(match[2].toLowerCase()==='k'?1000:match[2]==='万'?10000:1);
  return Number.isInteger(value)&&value>=0&&value<=1000000?value:null;
};
export function validGoldTimeline(points:unknown):points is GoldTimelinePoint[]{
  if(!Array.isArray(points)||points.length<2||points.length>240)return false;
  let previous=-1;
  for(const item of points){
    if(!item||typeof item!=='object')return false;
    const point=item as GoldTimelinePoint;
    if(!Number.isInteger(point.timeSeconds)||point.timeSeconds<0||point.timeSeconds>7200||point.timeSeconds<=previous
      ||![point.blueGold,point.redGold].every(v=>Number.isInteger(v)&&v>=0&&v<=1000000))return false;
    previous=point.timeSeconds;
  }
  return true;
}
export function parseGoldTimelineText(text:string):GoldTimelinePoint[]{
  const lines=text.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!lines.length)throw new Error('Please provide at least two replay samples');
  const points:GoldTimelinePoint[]=[];
  for(const line of lines){
    if(/^time\s*[,;\t]/i.test(line))continue;
    const cells=line.split(/[,;\t]/).map(s=>s.trim());
    if(cells.length!==3)throw new Error('Each row must be: mm:ss, blue gold, red gold');
    const clock=/^(\d{1,3}):([0-5]\d)$/.exec(cells[0]);
    const timeSeconds=clock?Number(clock[1])*60+Number(clock[2]):/^\d+$/.test(cells[0])?Number(cells[0]):NaN;
    const blueGold=goldValue(cells[1]),redGold=goldValue(cells[2]);
    if(blueGold===null||redGold===null||!Number.isInteger(timeSeconds))throw new Error('Invalid time or gold value: '+line);
    points.push({timeSeconds,blueGold,redGold});
  }
  if(!validGoldTimeline(points))throw new Error('Provide 2–240 samples with strictly increasing times up to 120:00 and valid gold totals');
  return points;
}
export const timelineToText=(points:GoldTimelinePoint[])=>(points??[]).map(p=>`${Math.floor(p.timeSeconds/60)}:${String(p.timeSeconds%60).padStart(2,'0')},${p.blueGold},${p.redGold}`).join('\n');
