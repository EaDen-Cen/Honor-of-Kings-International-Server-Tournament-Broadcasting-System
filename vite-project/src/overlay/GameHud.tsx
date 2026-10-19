import { useEffect, useState, type CSSProperties } from 'react';
import type { MatchState, Side } from '../shared/types';
import { currentGame, displaySides } from '../shared/draftRules';
import { stageName } from '../shared/display';
import { portraitAssetURL } from '../shared/config';
import { playerAtSlot } from '../shared/playerSlots';
import { heroForState } from '../shared/heroData';
import './gameHud.css';

/** OBS Browser Source, 1920x1080. All non-HUD pixels stay transparent.
 * We do not replace the spectator minimap, controls or gameplay feed.
 * The two thin top rows are the only opaque regions in the compact mode. */
export function GameHud({state}:{state:MatchState}) {
  const zh=state.language==='zh',stats=state.liveGameStats;
  const [left,right]=displaySides(state);
  // Legacy states without widthPercent remain full width; ignore invalid imported values.
  const requestedWidth=stats.widthPercent??100;
  const widthPercent=Number.isInteger(requestedWidth)&&requestedWidth>=50&&requestedWidth<=100?requestedWidth:100;
  const ribbonStyle={'--hud-scale':String(widthPercent/100)} as CSSProperties;
  const [now,setNow]=useState(Date.now);
  const ocr=Object.values(stats.sources??{}).filter(source=>source.source==='ocr');
  useEffect(()=>{
    if(!ocr.length)return;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[ocr.length]);
  const stale=ocr.some(source=>now-source.capturedAt>15000);
  const gold=(side:Side)=>stats[`${side}Gold`]===undefined?'—':`${(stats[`${side}Gold`]!/1000).toFixed(1)}k`;
  const time=stats.gameTimeSeconds===undefined?'--:--':`${Math.floor(stats.gameTimeSeconds/60)}:${String(stats.gameTimeSeconds%60).padStart(2,'0')}`;
  const team=(side:Side,position:'left'|'right')=>{
    const data=state[`${side}Team`];
    return <div className={`game-hud-team ${side} display-${position}`}>
      {data.logo?<img className="game-hud-logo" src={portraitAssetURL(data.logo)} alt=""/>:<span className="game-hud-logo-placeholder" aria-hidden="true"/>}
      <strong title={data.name}>{data.name}</strong>
      <span className="game-hud-series" aria-label={zh?'系列赛比分':'Series score'}>{state[`${side}Score`]}</span>
    </div>;
  };
  const roster=(side:Side)=>Array.from({length:5},(_,slot)=>{
    const heroId=state[`${side}Assignments`]?.[slot]??state[`${side}Picks`]?.[slot];
    const hero=heroId!=null?heroForState(state,heroId):undefined;
    const identity=playerAtSlot(state,side,slot);
    return <span key={slot} className="game-hud-player" title={identity.id||`P${slot+1}`}>
      {hero?.imageLink?<img src={hero.imageLink} alt=""/>:<span className="game-hud-hero-unknown"/>}
      <span className="game-hud-player-id">{identity.id||`P${slot+1}`}</span>
    </span>;
  });
  const metric=(label:string,l:string|number,r:string|number,accent=false)=><div className={`game-hud-metric ${accent?'accent':''}`}>
    <b className={`game-hud-metric-left ${left}`}>{l}</b><small>{label}</small><b className={`game-hud-metric-right ${right}`}>{r}</b>
  </div>;
  return <div className={`game-hud ${stats.density}`} data-testid="game-hud">
    <div className="game-hud-scoreboard" style={ribbonStyle} data-testid="game-hud-ribbon">
      <header className="game-hud-main">
        {team(left,'left')}
        <div className="game-hud-center">
          <span className="game-hud-match">{zh?`第${currentGame(state)}局`:`GAME ${currentGame(state)}`} · {state.seriesFormat}</span>
          <div className="game-hud-kills"><b className={left}>{stats[`${left}Kills`]}</b><span className="game-hud-clock">{time}</span><b className={right}>{stats[`${right}Kills`]}</b></div>
        </div>
        {team(right,'right')}
      </header>
      <div className="game-hud-details">
        <span className="game-hud-stage" title={stageName(state.stage,state.language)}>{stageName(state.stage,state.language)}</span>
        <div className="game-hud-metrics">
          {metric(zh?'推塔':'TOWERS',stats[`${left}Towers`],stats[`${right}Towers`])}
          {(stats.blueGold!==undefined||stats.redGold!==undefined)&&metric(zh?'经济':'GOLD',gold(left),gold(right),true)}
          {stats.neutralObjectives.slice(0,stats.density==='full'?6:2).map(item=><div className="game-hud-metric objective" key={item.id}>
            <b className={`game-hud-metric-left ${left}`}>{item[left]}</b>
            {item.icon&&<img src={portraitAssetURL(item.icon)} alt=""/>}
            <small title={item.name}>{item.name}</small>
            <b className={`game-hud-metric-right ${right}`}>{item[right]}</b>
          </div>)}
        </div>
        <span className="game-hud-capture" title={stale?(zh?'采集数据已过期':'Capture data is stale'):ocr.length?(zh?'数据由采集核验':'Capture verified'):(zh?'人工数据':'Manual data')}>
          <span className={`game-hud-indicator ${stale?'stale':ocr.length?'verified':'manual'}`}/>
          {stale?(zh?'数据待更新':'STALE'):ocr.length?(zh?'已核验':'VERIFIED'):(zh?'人工':'MANUAL')}
        </span>
      </div>
      {stats.density==='full'&&<div className="game-hud-rosters">
        <div className={`game-hud-roster-side display-left ${left}`}>{roster(left)}</div>
        <span className="game-hud-roster-label">{zh?'最终阵容':'LINEUPS'}</span>
        <div className={`game-hud-roster-side display-right ${right}`}>{roster(right)}</div>
      </div>}
    </div>
    <span className="game-hud-accessible-status">{zh?'局内赛事信息':'Live match scoreboard'} · {zh?'游戏时间':'Game time'} {time}</span>
  </div>;
}
