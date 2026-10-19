import {useState} from 'react';
import type { MatchState, PlayerRole } from '../shared/types';
import {portraitAssetURL} from '../shared/config';
import { heroForState } from '../shared/heroData';
import { formatPostGameValue, postGameMetricLabel, reliableField, type PostGameMetric, type PostGamePlayer, type PostGameReport } from '../shared/postGame';
import { reportGoldDifference,formatEconomyTime } from '../shared/postGameTimeline';
import {EconomyAdvantageChart} from './EconomyAdvantageChart';
import {postGamePlayerIdentity} from '../shared/postGamePresentation';
import './postGameBroadcast.css';

const roles:PlayerRole[]=['clash','jungle','mid','farm','roam'];
const roleNames:Record<PlayerRole,[string,string]>={
  clash:['对抗路','Clash'],jungle:['打野','Jungle'],mid:['中路','Mid'],farm:['发育路','Farm'],roam:['游走','Roam']
};
const radarKeys:PostGameMetric[]=['totalDamage','damageTaken','gold','participation','towerDamage','healing'];
const format=(player:PostGamePlayer|undefined,key:PostGameMetric)=>{
  const field=player?.fields[key];return formatPostGameValue(reliableField(field)?field!.value:null,key);
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

function CompetitorArtwork({sources,name,zh}:{sources:string[];name:string;zh:boolean}){
  const [index,setIndex]=useState(0),source=sources[index];
  return source?<img src={source} alt={name} onError={()=>setIndex(previous=>previous+1)}/>:<span>{zh?'选手图片暂不可用':'Player artwork unavailable'}</span>;
}
function Competitor({player,state,zh}:{player?:PostGamePlayer;state:MatchState;zh:boolean}){
  const hero=player?heroForState(state,player.heroId):undefined;
  const grade=player?.grade&&(player.grade.manual||player.grade.confidence>=.85)?player.grade.value:undefined;
  const runtime=player?state.heroArtOverrides[String(player.heroId)]:undefined;
  const heroArt=state.artSourceMode==='legacy'||runtime?.useLegacyImage?hero?.imageLink:hero?.artLink;
  const sources=[...new Set([portraitAssetURL(player?.portrait??''),heroArt,hero?.imageLink].filter((source):source is string=>!!source))];
  return <aside className={'pg-matchup-player '+(player?.side??'')} aria-label={zh?'对位选手':'Matchup player'}>
    <div className="pg-competitor-photo">
      <CompetitorArtwork key={`${player?.rowId}:${sources.join('|')}`} sources={sources} name={player?.playerId||'Player artwork'} zh={zh}/>
    </div>
    <div className={'pg-player '+(player?.side??'')}>
      {hero?.imageLink&&<img className="pg-hero-icon" src={hero.imageLink} alt=""/>}
      <div><small>{player?.teamName??'—'}</small><strong>{player?.playerId||'—'}</strong><span>{zh?hero?.chineseName:hero?.englishName}{grade&&(' · '+(zh?'游戏评级':'Game grade')+' '+grade)}</span></div>
    </div>
  </aside>;
}
function Comparison({state,report,zh,selectedRole}:{state:MatchState;report:PostGameReport;zh:boolean;selectedRole?:PlayerRole}){
  // Fixed OBS paths do not expose a role switcher; support legacy ?role links.
  const wanted=selectedRole??new URLSearchParams(window.location.search).get('role');
  const selected=roles.includes(wanted as PlayerRole)?wanted as PlayerRole:'clash';
  const players=report.players.map(player=>postGamePlayerIdentity(state,player));
  const blue=players.filter(p=>p.side==='blue'&&p.role===selected);
  const red=players.filter(p=>p.side==='red'&&p.role===selected);
  if(blue.length!==1||red.length!==1)return <div className="pg-unavailable pg-center">
    {zh?('无法安全展示'+roleNames[selected][0]+'对位：双方必须各有一位已绑定该位置的选手。请在 Control 核对选手 ID 顺序及本局角色。'):
      ('Cannot safely show '+roleNames[selected][1]+' matchup: each side needs exactly one player with this role. Verify ID order and roles in Control.')}
  </div>;
  const left=blue[0],right=red[0];
  const stats:PostGameMetric[]=['kills','deaths','assists','gold','goldShare','totalDamage','damageShare','damageTaken','participation','towerDamage'];
  if(reliableField(left.fields.rating)||reliableField(right.fields.rating))stats.unshift('rating');
  return <>
    <div className="pg-matchup-heading"><span>{roleNames[selected][zh?0:1]}</span><strong>HEAD TO HEAD</strong></div>
    <div className="pg-matchup-stage" data-matchup-role={selected}>
      <Competitor player={left} state={state} zh={zh}/>
      <div className="pg-center-analysis">
        <DataRadar blue={left} red={right} zh={zh}/>
        <div className="pg-number-compare">{stats.map(key=><div key={key} className="pg-stat-line"><strong>{format(left,key)}</strong><span>{postGameMetricLabel(key,zh)}</span><strong>{format(right,key)}</strong></div>)}</div>
      </div>
      <Competitor player={right} state={state} zh={zh}/>
    </div>
    <footer className="pg-footer">{zh?'仅展示已核验或人工确认的数据 · 此 OBS 对位场景固定绑定该位置':'Verified or manually confirmed metrics only · This OBS matchup scene has a fixed role'}</footer>
  </>;
}
function Progress({report,zh}:{report:PostGameReport;zh:boolean}){
  const points=reportGoldDifference(report);
  if(points.length<2)return <div className="pg-unavailable pg-center">{zh?'尚无经济优势曲线。在 Control 采集游戏「对局」页，确认左右队伍后应用，即可自动显示。':'No economy advantage curve yet. Capture the game recap in Control, confirm sides, then apply.'}</div>;
  const newest=points.at(-1)!,advantage=newest.difference;
  return <div className="pg-progress-content">
    <div className="pg-progress-legend"><div><i className={advantage>=0?'pg-dot blue':'pg-dot red'}/> {advantage===0?(zh?'双方持平':'EVEN'):advantage>0?(zh?'蓝方领先':'Blue advantage'):(zh?'红方领先':'Red advantage')} <b>{Math.abs(advantage).toLocaleString()}</b></div><small>{zh?'中间为零，上蓝下红；显示双方经济优势差，不显示两条总经济曲线。':'Zero at the center; blue above, red below. Shows signed economy advantage, not cumulative gold totals.'}</small></div>
    <EconomyAdvantageChart points={points} maxDifference={report.goldDifference?.maxDifference} durationSeconds={report.goldDifference?.durationSeconds} zh={zh} className="pg-progress-chart"/>
    <footer className="pg-footer">{zh?`共 ${points.length} 个曲线点 · ${formatEconomyTime(points[0].timeSeconds)} 至 ${formatEconomyTime(newest.timeSeconds)} · ${report.goldDifference?.source==='settlement'?'截图刻度和标记估计':'人工回放数据'}`:`${points.length} curve samples · ${formatEconomyTime(points[0].timeSeconds)} to ${formatEconomyTime(newest.timeSeconds)} · ${report.goldDifference?.source==='settlement'?'estimated from screenshot markers and axes':'manual replay observations'}`}</footer>
    {report.goldDifference?.partial&&<p className="pg-footer">{zh?'部分曲线：末尾标记被遮挡，仅显示已识别点。':'Partial screenshot curve: final marker obscured; observed points only.'}</p>}
  </div>;
}
export function PostGameBroadcast({state,mode,compareRole}:{state:MatchState;mode:'compare'|'progress';compareRole?:PlayerRole}){
  const report=state.postGameReports.find(r=>r.id===state.activePostGameReportId),zh=state.language==='zh';
  if(!report)return <section className="pg-broadcast"><div className="pg-broadcast-glow"/><header className="pg-broadcast-header"><div className="pg-eyebrow">CHASING WIND · ESPORT BROADCAST</div><h1>{zh?'暂无本局赛后报告':'NO POST-GAME REPORT'}</h1><p>{zh?'请在 Control 中确认本局有效并创建十人赛后报告，再打开此 OBS 场景。':'Confirm and prepare the ten-player report in Control before opening this scene.'}</p></header></section>;
  const blue=report.players.find(p=>p.side==='blue'),red=report.players.find(p=>p.side==='red');
  return <section className={`pg-broadcast pg-${mode}`}>
    <div className="pg-broadcast-glow"/>
    <header className="pg-broadcast-header"><div className="pg-eyebrow">CHASING WIND · ESPORT BROADCAST</div><h1>{mode==='progress'?(zh?'游戏进程 · 经济优势':'GAME PROGRESS · ECONOMY ADVANTAGE'):(zh?'赛后对位分析':'POST-GAME MATCHUP')}</h1><p>{report.stage} · GAME {report.gameNumber} · {report.seriesFormat}</p></header>
    <div className="pg-team-banner"><span>{blue?.teamName||'BLUE TEAM'}</span><em>VS</em><span>{red?.teamName||'RED TEAM'}</span></div>
    {mode==='progress'?<Progress report={report} zh={zh}/>:<Comparison state={state} report={report} zh={zh} selectedRole={compareRole}/>}
  </section>;
}
