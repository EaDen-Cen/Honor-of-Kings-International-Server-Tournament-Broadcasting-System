import { useEffect, useState, type CSSProperties } from 'react';
import type { MatchState, Side } from '../shared/types';
import { portraitAssetURL } from '../shared/config';
import { displayedGameSeconds, totalNeutralObjectives } from '../shared/liveGame';
import './gameHud.css';

/** Transparent 1920×1080 OBS browser source. All live match metrics fit in
 * one horizontal row; full mode adds ONLY neutral-objective presence below. */
export function GameHud({state}:{state:MatchState}) {
  const zh=state.language==='zh',stats=state.liveGameStats;
  const requestedWidth=stats.widthPercent??65;
  const widthPercent=Number.isInteger(requestedWidth)&&requestedWidth>=50&&requestedWidth<=100?requestedWidth:65;
  const requestedHeight=stats.heightPx??132;
  const heightPx=Number.isInteger(requestedHeight)&&requestedHeight>=64&&requestedHeight<=200?requestedHeight:132;
  const ribbonStyle={'--hud-scale':String(widthPercent/100),'--hud-row-height':`${heightPx}px`} as CSSProperties;
  const [now,setNow]=useState(Date.now);
  // This timer only updates the displayed, OCR-anchored seconds. Capture and
  // validation are performed separately by LiveHudCapturePanel.
  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[]);
  const ocr=Object.values(stats.sources??{}).filter(source=>source.source==='ocr');
  const stale=ocr.some(source=>now-source.capturedAt>15000);
  const seconds=displayedGameSeconds(stats,now);
  const time=seconds===undefined?'--:--':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  const gold=(side:Side)=>stats[`${side}Gold`]===undefined?'—':`${(stats[`${side}Gold`]!/1000).toFixed(1)}k`;
  const team=(side:Side)=> {
    const data=state[`${side}Team`];
    return <div className={`game-hud-team ${side}`} data-testid={`game-hud-${side}-team`}>
      {data.logo?<img className="game-hud-logo" src={portraitAssetURL(data.logo)} alt=""/>:null}
      <strong title={data.name}>{data.name}</strong>
    </div>;
  };
  const cell=(side:Side,kind:string,value:string|number,label:string)=><div className={`game-hud-cell ${side}`} data-testid={`game-hud-${side}-${kind}`}>
    <span className="game-hud-cell-value">{value}</span>
    <small>{label}</small>
  </div>;
  const objectiveCount=(side:Side)=>cell(side,'objectives',totalNeutralObjectives(stats,side),zh?'资源':'OBJ');
  const towers=(side:Side)=>cell(side,'towers',stats[`${side}Towers`],zh?'推塔':'TOWERS');
  const economy=(side:Side)=>cell(side,'gold',gold(side),zh?'经济':'GOLD');
  const kills=(side:Side)=>cell(side,'kills',stats[`${side}Kills`],zh?'人头':'KILLS');
  const score=(side:Side)=>cell(side,'score',state[`${side}Score`],zh?'比分':'SCORE');
  const objectivePresence=stats.neutralObjectives.length?stats.neutralObjectives:[
    {id:'tyrant',name:'暴君 / Tyrant',icon:'',blue:0,red:0,status:'unknown' as const},
    {id:'overlord',name:'主宰 / Overlord',icon:'',blue:0,red:0,status:'unknown' as const},
  ];
  return <div className={`game-hud ${stats.density}`} data-testid="game-hud">
    <div className="game-hud-scoreboard" style={ribbonStyle} data-testid="game-hud-ribbon">
      <header className="game-hud-main" data-testid="game-hud-single-row">
        {team('blue')}
        {objectiveCount('blue')}
        {towers('blue')}
        {economy('blue')}
        {kills('blue')}
        {score('blue')}
        <div className="game-hud-time" data-testid="game-hud-clock">
          <strong className="game-hud-clock">{time}</strong>
          <small>{zh?'游戏时间':'GAME TIME'}</small>
        </div>
        {score('red')}
        {kills('red')}
        {economy('red')}
        {towers('red')}
        {objectiveCount('red')}
        {team('red')}
      </header>
      {stats.density==='full'&&<div className="game-hud-objective-status" data-testid="game-hud-objective-status">
        {objectivePresence.map(item=><div className="game-hud-objective" key={item.id}>
          {item.icon&&<img src={portraitAssetURL(item.icon)} alt=""/>}
          <span title={item.name}>{item.name}</span>
          <b className={`game-hud-presence ${item.status??'unknown'}`}>
            {item.status==='alive'?(zh?'存活':'ALIVE'):item.status==='down'?(zh?'已击败':'DOWN'):(zh?'未知':'UNKNOWN')}
          </b>
        </div>)}
        <span className="game-hud-capture" title={stale?(zh?'采集数据已过期':'Capture data is stale'):ocr.length?(zh?'最近由 OCR 核验':'Recent OCR verification'):(zh?'人工数据':'Manual data')}>
          <span className={`game-hud-indicator ${stale?'stale':ocr.length?'verified':'manual'}`}/>
          {stale?(zh?'数据待更新':'STALE'):ocr.length?(zh?'OCR':'OCR'):(zh?'人工':'MANUAL')}
        </span>
      </div>}
    </div>
    <span className="game-hud-accessible-status">{zh?'游戏时间':'Game time'} {time}</span>
  </div>;
}
