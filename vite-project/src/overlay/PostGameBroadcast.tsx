import type { MatchState, PlayerRole } from '../shared/types';
import { heroForState } from '../shared/heroData';
import { postGameMetricLabel, reliableField, type PostGameMetric, type PostGamePlayer, type PostGameReport } from '../shared/postGame';
import { validGoldTimeline } from '../shared/postGameTimeline';
import './postGameBroadcast.css';

const roles:PlayerRole[]=['clash','jungle','mid','farm','roam'];
const roleNames:Record<PlayerRole,[string,string]>={
  clash:['对抗路','Clash'],jungle:['打野','Jungle'],mid:['中路','Mid'],farm:['发育路','Farm'],roam:['游走','Roam']
};
const radarKeys:PostGameMetric[]=['totalDamage','damageTaken','gold','participation','towerDamage','healing'];
const format=(player:PostGamePlayer|undefined,key:PostGameMetric)=>{
  const field=player?.fields[key];return reliableField(field)?field!.value.toLocaleString()+(key==='participation'||key==='damageShare'?'%':''):'—';
};
function DataRadar({blue,red,zh}:{blue?:PostGamePlayer;red?:PostGamePlayer;zh:boolean}){
  const fields=radarKeys.filter(key=>reliableField(blue?.fields[key])&&reliableField(red?.fields[key]));
  if(fields.length<3)return <div className="pg-unavailable">{zh?'至少需要 3 项双方均已核验的数据才能显示雷达图。':'Radar needs three verified metrics for both players.'}</div>;
  const mid=245,rad=164,n=fields.length;
  const at=(i:number,r:number)=>({x:mid+Math.sin(i*2*Math.PI/n)*r,y:mid-Math.cos(i*2*Math.PI/n)*r});
  const polygon=(side:'blue'|'red')=>fields.map((key,i)=>{
    const b=blue!.fields[key]!.value,r=red!.fields[key]!.value,max=Math.max(b,r);
    const point=at(i,max===0?0:rad*(side==='blue'?b:r)/max);return `${point.x},${point.y}`;
  }).join(' ');
  return <div className="pg-radar">
    <svg width="490" height="490" viewBox="0 0 490 490" role="img" aria-label={zh?'对位雷达：各轴按两位选手中较大值归一化':'Head-to-head radar normalized per axis to the larger player value'}>
      {[.25,.5,.75,1].map(level=><polygon key={level} points={fields.map((_,i)=>{const p=at(i,rad*level);return `${p.x},${p.y}`;}).join(' ')} fill="none" stroke="#aab7c633" strokeWidth="1"/>)}
      {fields.map((key,i)=>{const p=at(i,rad),label=at(i,rad+43);return <g key={key}><line x1={mid} y1={mid} x2={p.x} y2={p.y} stroke="#c5cdd533"/><text x={label.x} y={label.y} fontSize="17" fill="#d1d8e2" textAnchor="middle" dominantBaseline="middle">{postGameMetricLabel(key,zh)}</text></g>;})}
      <polygon points={polygon('blue')} fill="#4cbbf044" stroke="#69cbff" strokeWidth="3"/>
      <polygon points={polygon('red')} fill="#ef667044" stroke="#ff8990" strokeWidth="3"/>
    </svg>
    <p>{zh?'每个轴仅比较两人的相对数值，不是游戏官方评分；承伤、治疗等也不直接代表表现优劣。':'Axes are relative to these two players, not official ratings or an overall performance verdict.'}</p>
  </div>;
}
function Competitor({player,state,zh}:{player?:PostGamePlayer;state:MatchState;zh:boolean}){
  const hero=player?heroForState(state,player.heroId):undefined;
  return <div className={`pg-player ${player?.side??''}`}>
    {hero?.imageLink&&<img className="pg-hero-icon" src={hero.imageLink} alt=""/>}
    <div><small>{player?.teamName??'—'}</small><strong>{player?.playerId||'—'}</strong><span>{zh?hero?.chineseName:hero?.englishName}</span></div>
  </div>;
}
function Comparison({state,report,zh}:{state:MatchState;report:PostGameReport;zh:boolean}){
  const wanted=new URLSearchParams(window.location.search).get('role');
  const selected=roles.includes(wanted as PlayerRole)?wanted as PlayerRole:'clash';
  const pair=(side:'blue'|'red',role:PlayerRole)=>report.players.find(p=>p.side===side&&p.role===role);
  const blue=pair('blue',selected),red=pair('red',selected);
  const stats:PostGameMetric[]=['rating','kills','deaths','assists','gold','totalDamage','damageShare','damageTaken','participation','towerDamage'];
  return <>
    <div className="pg-role-tabs">{roles.map(role=><span key={role} className={role===selected?'active':''}>{roleNames[role][zh?0:1]}</span>)}</div>
    <div className="pg-compare-body">
      <div className="pg-duel-top"><Competitor player={blue} state={state} zh={zh}/><span className="pg-versus">VS</span><Competitor player={red} state={state} zh={zh}/></div>
      <div className="pg-compare-layout">
        <div className="pg-number-compare">{stats.map(key=><div key={key} className="pg-stat-line"><strong>{format(blue,key)}</strong><span>{postGameMetricLabel(key,zh)}</span><strong>{format(red,key)}</strong></div>)}</div>
        <DataRadar blue={blue} red={red} zh={zh}/>
      </div>
    </div>
    <footer className="pg-footer">{zh?'仅展示已核验/人工确认数据 · 改变 OBS 链接的 ?role=clash/jungle/mid/farm/roam 可切换对位':'Verified or manually confirmed data only · Set ?role=clash/jungle/mid/farm/roam to choose a matchup'}</footer>
  </>;
}
function Progress({report,zh}:{report:PostGameReport;zh:boolean}){
  const points=validGoldTimeline(report.goldTimeline)?report.goldTimeline:[];
  if(points.length<2)return <div className="pg-unavailable pg-center">{zh?'尚无经济时间线。请在 Control 中导入回放的至少两个实际时间点；不能用结算总经济反推曲线。':'No verified time-series yet. Import at least two actual replay samples in Control; final totals cannot reconstruct a match.'}</div>;
  const x0=110,y0=575,w=1430,h=440,last=points[points.length-1].timeSeconds,first=points[0].timeSeconds,span=Math.max(1,last-first),maxValue=Math.max(1,...points.flatMap(p=>[p.blueGold,p.redGold]));
  const max=Math.ceil(maxValue/5000)*5000;
  const xp=(s:number)=>x0+(s-first)/span*w,yp=(gold:number)=>y0-gold/max*h;
  const lines=(team:'blueGold'|'redGold')=>points.map(p=>`${xp(p.timeSeconds)},${yp(p[team])}`).join(' ');
  const fmtTime=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  const newest=points.at(-1)!;
  return <div className="pg-progress-content">
    <div className="pg-progress-legend"><div><i className="pg-dot blue"/> {zh?'蓝方经济':'Blue gold'} <b>{newest.blueGold.toLocaleString()}</b></div><div><i className="pg-dot red"/> {zh?'红方经济':'Red gold'} <b>{newest.redGold.toLocaleString()}</b></div><small>{zh?'曲线只连接已导入的实测点，未采集时段没有被推算。':'Lines join imported observations only; missing intervals are not estimated.'}</small></div>
    <svg className="pg-progress-chart" viewBox="0 0 1640 690" role="img" aria-label={zh?'经济随游戏时间变化的曲线':'Gold totals by game time'}>
      {[0,.25,.5,.75,1].map(n=><g key={n}><line x1={x0} y1={yp(max*n)} x2={x0+w} y2={yp(max*n)} stroke="#a8b5c74d"/><text x={x0-20} y={yp(max*n)+7} fill="#c1ccdc" textAnchor="end" fontSize="18">{Math.round(max*n/1000)}K</text></g>)}
      {[0,.25,.5,.75,1].map(n=><g key={n}><line x1={x0+w*n} y1={y0} x2={x0+w*n} y2={y0-h} stroke="#a8b5c722"/><text x={x0+w*n} y={y0+37} fill="#c1ccdc" textAnchor="middle" fontSize="18">{fmtTime(Math.round(first+span*n))}</text></g>)}
      <polyline points={lines('blueGold')} fill="none" stroke="#55c2ff" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round"/>
      <polyline points={lines('redGold')} fill="none" stroke="#ff778b" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map(p=><g key={p.timeSeconds}><circle cx={xp(p.timeSeconds)} cy={yp(p.blueGold)} r="5" fill="#55c2ff"/><circle cx={xp(p.timeSeconds)} cy={yp(p.redGold)} r="5" fill="#ff778b"/></g>)}
      <text x={x0+w/2} y={y0+94} fill="#f1f5ff" fontSize="22" textAnchor="middle">{zh?'游戏时间':'Game time'}</text>
    </svg>
    <footer className="pg-footer">{zh?`共 ${points.length} 个实测数据点 · ${fmtTime(first)} 至 ${fmtTime(last)}`:`${points.length} observed samples · ${fmtTime(first)} to ${fmtTime(last)}`}</footer>
  </div>;
}
export function PostGameBroadcast({state,mode}:{state:MatchState;mode:'compare'|'progress'}){
  const report=state.postGameReports.find(r=>r.id===state.activePostGameReportId),zh=state.language==='zh';
  if(!report)return null;
  const blue=report.players.find(p=>p.side==='blue'),red=report.players.find(p=>p.side==='red');
  return <section className="pg-broadcast">
    <div className="pg-broadcast-glow"/>
    <header className="pg-broadcast-header"><div className="pg-eyebrow">CHASING WIND · ESPORT BROADCAST</div><h1>{mode==='progress'?(zh?'游戏进程 · 经济走势':'GAME PROGRESS · GOLD'):(zh?'赛后对位分析':'POST-GAME MATCHUP')}</h1><p>{report.stage} · GAME {report.gameNumber} · {report.seriesFormat}</p></header>
    <div className="pg-team-banner"><span>{blue?.teamName||'BLUE TEAM'}</span><em>VS</em><span>{red?.teamName||'RED TEAM'}</span></div>
    {mode==='progress'?<Progress report={report} zh={zh}/>:<Comparison state={state} report={report} zh={zh}/>}
  </section>;
}
