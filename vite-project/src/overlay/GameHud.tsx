import type { MatchState, Side } from '../shared/types';
import { currentGame, displaySides } from '../shared/draftRules';
import { stageName } from '../shared/display';
import { portraitAssetURL } from '../shared/config';
import { playerAtSlot } from '../shared/playerSlots';
import { playerRoleLabel } from '../shared/postGamePresentation';
import { heroForState } from '../shared/heroData';
import './gameHud.css';
import { useEffect, useState } from 'react';
export function GameHud({state}:{state:MatchState}){
  const zh=state.language==='zh',stats=state.liveGameStats;
  const [left,right]=displaySides(state);
  const [now,setNow]=useState(Date.now);
  const sources=Object.values(stats.sources??{}),ocr=sources.filter(source=>source.source==='ocr');
  useEffect(()=>{if(!ocr.length)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[ocr.length]);
  const stale=ocr.some(source=>now-source.capturedAt>15000);
  const gold=(side:Side)=>stats[`${side}Gold`]===undefined?'—':`${(stats[`${side}Gold`]!/1000).toFixed(1)}K`;
  const time=stats.gameTimeSeconds===undefined?'—':`${Math.floor(stats.gameTimeSeconds/60)}:${String(stats.gameTimeSeconds%60).padStart(2,'0')}`;
  function team(side:Side){const data=state[`${side}Team`];return <div className={`game-hud-team ${side}`}>
    {data.logo&&<img className="game-hud-logo" src={portraitAssetURL(data.logo)} alt=""/>}<strong>{data.name}</strong>
    <span className="game-hud-series" aria-label={zh?'系列赛比分':'Series score'}>{state[`${side}Score`]}</span>
  </div>;}
  const lineup=(side:Side,position:'left'|'right')=><aside className={`game-hud-lineup ${side} display-${position}`} aria-label={zh?'选手名单':'Player lineup'}>
    <div className="game-hud-lineup-title">{state[`${side}Team`].name}</div>
    {Array.from({length:5},(_,slot)=>{
      const heroId=(state[`${side}Assignments`]?.[slot]??state[`${side}Picks`]?.[slot]) as number|undefined;
      const hero=heroId!==undefined?heroForState(state,heroId):undefined;
      const identity=playerAtSlot(state,side,slot);
      const player=identity.id||`P${slot+1}`;
      return <div key={slot} className="game-hud-roster-row">
        <span className="game-hud-roster-position">{slot+1}</span>
        {hero?.imageLink?<img src={hero.imageLink} alt=""/>:<span className="game-hud-roster-unknown"/>}
        <div className="game-hud-roster-identity"><strong title={player}>{player}</strong><small>{playerRoleLabel(identity.role,zh)}</small></div>
      </div>;
    })}
  </aside>;
  return <div className={`game-hud ${stats.density}`}>
    <div className="game-hud-opaque-top" aria-hidden="true"/>
    <div className="game-hud-opaque-left" aria-hidden="true"/>
    <div className="game-hud-opaque-right" aria-hidden="true"/>
    <div className="game-hud-opaque-bottom" aria-hidden="true"/>
    <div className="game-hud-map-cover"><strong>CHASING WIND</strong><span>{zh?'赛事地图源 · 未接入':'MAP FEED · NOT CONNECTED'}</span></div>
    {lineup(left,'left')}{lineup(right,'right')}
    <header>{team(left)}<div className="game-hud-center"><b>{zh?'第':'Game '}{currentGame(state)}{zh?'局':''} · {state.seriesFormat}</b><small>{stageName(state.stage,state.language)}</small><time>{time}</time></div>{team(right)}</header>
    <div className="game-hud-stats"><span><b>{stats[`${left}Kills`]}</b> {zh?'人头':'Kills'} <b>{stats[`${right}Kills`]}</b></span>
      <span><b>{stats[`${left}Towers`]}</b> {zh?'推塔':'Towers'} <b>{stats[`${right}Towers`]}</b></span>
      {(stats.blueGold!==undefined||stats.redGold!==undefined)&&<span><b>{gold(left)}</b> {zh?'经济':'Gold'} <b>{gold(right)}</b></span>}
      {stats.density==='full'&&stats.neutralObjectives.map(item=><span key={item.id}><b>{item[left]}</b>{item.icon&&<img src={portraitAssetURL(item.icon)} alt=""/>}<em title={item.name}>{item.name}</em><b>{item[right]}</b></span>)}
    </div>
    <small className={`game-hud-status ${stale?'stale':''}`}>Experimental · {stale?(zh?'采集过期，保留最后可信值':'Capture stale · last trusted values'):ocr.length?(zh?'已核验采样':'Verified capture'):(zh?'人工数据':'Manual data')}</small>
  </div>;
}
