import {useId} from 'react';
import {formatEconomyTime,type GoldDifferencePoint} from '../shared/postGameTimeline';
export function EconomyAdvantageChart({points,maxDifference,durationSeconds,zh,className}:{points:GoldDifferencePoint[];maxDifference?:number;durationSeconds?:number;zh:boolean;className?:string}){
  const clip=useId().replace(/:/g,''),x0=80,w=1400,y0=340,h=230;
  if(points.length<2)return null;
  const first=points[0].timeSeconds,last=points.at(-1)!.timeSeconds;
  const end=durationSeconds!==undefined&&Number.isInteger(durationSeconds)&&durationSeconds>=last&&durationSeconds<=7200?durationSeconds:last;
  const span=Math.max(1,end-first);
  const max=Math.max(1,maxDifference??0,...points.map(p=>Math.abs(p.difference)));
  const xp=(s:number)=>x0+(s-first)/span*w,yp=(difference:number)=>y0-difference/max*h;
  const line=points.map(p=>`${xp(p.timeSeconds)},${yp(p.difference)}`).join(' ');
  const area=`${xp(first)},${y0} ${line} ${xp(last)},${y0}`;
  return <svg className={className} style={{width:'100%',display:'block'}} data-axis="sideways-t" viewBox="0 0 1640 690" role="img" aria-label={zh?'双方经济优势：中间零线，上蓝下红，右侧纵轴':'Economy advantage: central zero line, blue above, red below, right vertical axis'}>
    <defs><clipPath id={`${clip}-blue`}><rect x={x0} y={y0-h} width={w} height={h}/></clipPath><clipPath id={`${clip}-red`}><rect x={x0} y={y0} width={w} height={h}/></clipPath></defs>
    {[-1,-.5,.5,1].map(n=><g key={n}><line x1={x0} y1={yp(max*n)} x2={x0+w} y2={yp(max*n)} stroke="#a8b5c72c" strokeDasharray="5 8"/><text x={x0+w+18} y={yp(max*n)+7} fill={n>0?'#55c2ff':'#ff778b'} fontSize="21">+{(Math.abs(max*n)/1000).toLocaleString(undefined,{maximumFractionDigits:2})}K</text></g>)}
    {[0,.25,.5,.75,1].map(n=><g key={n}><line x1={x0+w*n} y1={y0-h} x2={x0+w*n} y2={y0+h} stroke="#a8b5c71a"/><text x={x0+w*n} y={y0+h+40} fill="#c1ccdc" textAnchor="middle" fontSize="20">{formatEconomyTime(Math.round(first+span*n))}</text></g>)}
    <polygon points={area} fill="#55c2ff33" clipPath={`url(#${clip}-blue)`}/><polygon points={area} fill="#ff778b33" clipPath={`url(#${clip}-red)`}/>
    <polyline points={line} fill="none" stroke="#55c2ff" strokeWidth="5" strokeLinejoin="round" clipPath={`url(#${clip}-blue)`}/><polyline points={line} fill="none" stroke="#ff778b" strokeWidth="5" strokeLinejoin="round" clipPath={`url(#${clip}-red)`}/>
    <line className="economy-zero-axis" x1={x0} y1={y0} x2={x0+w} y2={y0} stroke="#d4e0ed" strokeWidth="2"/><line className="economy-right-axis" x1={x0+w} y1={y0-h} x2={x0+w} y2={y0+h} stroke="#d4e0ed" strokeWidth="2"/>
    <text x={x0+w+18} y={y0+7} fill="#f1f5ff" fontSize="21">0</text>
    {points.map(p=><circle key={p.timeSeconds} cx={xp(p.timeSeconds)} cy={yp(p.difference)} r="5" fill={p.difference>=0?'#55c2ff':'#ff778b'} stroke="#f3f7ff" strokeWidth="1.5"/>)}
    <text x={x0+10} y={y0-h-22} fill="#55c2ff" fontSize="21">{zh?'蓝方领先':'BLUE ADVANTAGE'}</text><text x={x0+10} y={y0+h+80} fill="#ff778b" fontSize="21">{zh?'红方领先':'RED ADVANTAGE'}</text>
  </svg>;
}
