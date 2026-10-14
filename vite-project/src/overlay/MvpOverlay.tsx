import type { MatchState } from '../shared/types';
import { heroForState } from '../shared/heroData';
import { highlightStats, postGameMetricLabel, reliableField, type PostGameMetric } from '../shared/postGame';
import './mvpOverlay.css';
export function MvpOverlay({state}:{state:MatchState}){
  const report=state.postGameReports.find(r=>r.id===state.activePostGameReportId),zh=state.language==='zh';
  const player=report?.players.find(p=>p.rowId===report.selectedMvpRowId);
  if(!player||!report)return null;
  const hero=heroForState(state,player.heroId);
  const value=(key:PostGameMetric)=>reliableField(player.fields[key])?player.fields[key]!.value.toLocaleString()+(key==='participation'||key==='damageShare'?'%':''):'—';
  const statTiles:PostGameMetric[]=['rating','totalDamage','damageTaken','participation'];
  return <article className={`mvp-screen ${player.side}`}>
    <div className="mvp-screen-accent" />
    <header className="mvp-screen-header"><span>CHASING WIND · ESPORT BROADCAST</span><span>{report.stage} · GAME {report.gameNumber} · {report.seriesFormat}</span></header>
    <section className="mvp-screen-portrait">
      {player.portrait||hero?.artLink||hero?.imageLink?<img src={player.portrait||hero?.artLink||hero?.imageLink} alt={player.playerId}/>:<div className="mvp-screen-initials">{player.playerId.slice(0,2).toUpperCase()||`P${player.slot+1}`}</div>}
      <div className="mvp-screen-portrait-label">MOST VALUABLE PLAYER</div>
    </section>
    <section className="mvp-screen-info">
      <div className="mvp-screen-kicker">{zh?'全场最佳选手':'MATCH MVP'} <span>★</span></div>
      <h1>MVP</h1>
      <div className="mvp-screen-team">{player.teamName}</div>
      <h2>{player.playerId||`P${player.slot+1}`}</h2>
      <div className="mvp-screen-hero">{hero?.imageLink&&<img src={hero.imageLink} alt=""/>}<span>{zh?hero?.chineseName:hero?.englishName||'—'}</span></div>
      <div className="mvp-screen-kda"><strong>{value('kills')} <em>/</em> {value('deaths')} <em>/</em> {value('assists')}</strong><small>K / D / A</small></div>
      <div className="mvp-screen-metrics">{statTiles.map(key=><div key={key}><span>{postGameMetricLabel(key,zh)}</span><strong>{value(key)}</strong></div>)}</div>
      <div className="mvp-screen-highlights">{highlightStats(player).map(({key,field})=><span key={key}>{postGameMetricLabel(key,zh)} · <b>{field.value.toLocaleString()}{key==='damageShare'||key==='participation'?'%':''}</b></span>)}</div>
    </section>
    <footer className="mvp-screen-footer"><span>{zh?'赛事方选择 · 系统不自动决定 MVP':'SELECTED BY EVENT ORGANIZERS · NOT AUTOMATICALLY SCORED'}</span><span>01 / MVP</span></footer>
  </article>;
}
