import { useState } from 'react';
import type { Action,MatchState } from '../shared/types';
import type { LiveGameStats } from '../shared/liveGame';
import { liveCaptureKeys, liveCaptureLabel } from '../shared/gameCapture';
import { LiveHudCapturePanel } from './LiveHudCapturePanel';
export function LiveGamePanel({state,token,disabled,send}:{state:MatchState;token:string;disabled:boolean;send:(action:Action)=>void}){
  const zh=state.language==='zh',stats=state.liveGameStats;
  const [name,setName]=useState(''),[icon,setIcon]=useState('');
  const update=(value:LiveGameStats)=>send({type:'live_game_stats',stats:value});
  const counter=(key:'blueKills'|'redKills'|'blueTowers'|'redTowers',label:string)=><div className="toolbar" key={key}><span>{label}</span>
    <button disabled={disabled||stats[key]===0} aria-label={`${key} minus`} onClick={()=>update({...stats,[key]:stats[key]-1})}>−</button>
    <input aria-label={key} type="number" min={0} max={999} value={stats[key]} disabled={disabled} onChange={e=>update({...stats,[key]:Number(e.target.value)})}/>
    <button disabled={disabled||stats[key]===999} aria-label={`${key} plus`} onClick={()=>update({...stats,[key]:stats[key]+1})}>+</button></div>;
  return <details className="panel"><summary>{zh?'局内 HUD / 人头、推塔与资源':'Live HUD / kills, towers and objectives'}</summary>
    <p className="muted">{zh?'OBS 浏览器源：/overlay/game-hud，1920×1080。所有变更支持顶部撤销。':'OBS Browser Source: /overlay/game-hud, 1920×1080. Use Undo to revert changes.'}</p>
    <LiveHudCapturePanel state={state} zh={zh} token={token} disabled={disabled} send={send}/>
    <div className="lineup-team-grid">{(['blue','red'] as const).map(side=><div key={side}><b>{state[`${side}Team`].name}</b>{counter(`${side}Kills`,zh?'人头':'Kills')}{counter(`${side}Towers`,zh?'推塔':'Towers')}</div>)}</div>
    <div className="toolbar">{(['blueGold','redGold','gameTimeSeconds'] as const).map(key=><label key={key}>{liveCaptureLabel(key,zh)}<input aria-label={key} type="number" min={0} max={key==='gameTimeSeconds'?7200:1000000} value={stats[key]??''} disabled={disabled} onChange={e=>{if(e.target.value!=='')update({...stats,[key]:Number(e.target.value)});}}/></label>)}</div>
    <div className="toolbar">{liveCaptureKeys.map(key=><label key={key}><input type="checkbox" checked={stats.sources?.[key]?.source==='manual'} disabled={disabled} onChange={e=>send({type:'live_game_freeze',key,frozen:e.target.checked})}/>{liveCaptureLabel(key,zh)} · {zh?'冻结（取消恢复自动）':'Freeze (uncheck to resume automatic)'}</label>)}</div>
    <label>{zh?'密度':'Density'} <select value={stats.density} disabled={disabled} onChange={e=>update({...stats,density:e.target.value as 'compact'|'full'})}><option value="compact">{zh?'简约':'Compact'}</option><option value="full">{zh?'完整':'Full'}</option></select></label>
    {stats.neutralObjectives.map((item,index)=><div className="toolbar" key={item.id}><b>{item.name}</b>{(['blue','red'] as const).map(side=><label key={side}>{state[`${side}Team`].name}<input aria-label={`${item.name} ${side}`} type="number" min={0} max={999} value={item[side]} disabled={disabled} onChange={e=>update({...stats,neutralObjectives:stats.neutralObjectives.map((v,i)=>i===index?{...v,[side]:Number(e.target.value)}:v)})}/></label>)}<button disabled={disabled} onClick={()=>update({...stats,neutralObjectives:stats.neutralObjectives.filter((_,i)=>i!==index)})}>{zh?'移除':'Remove'}</button></div>)}
    <div className="toolbar"><input aria-label="Objective name" placeholder={zh?'资源名称':'Objective name'} maxLength={24} value={name} onChange={e=>setName(e.target.value)}/><input aria-label="Objective icon" placeholder={zh?'图标 HTTPS/本地路径（可选）':'Icon HTTPS/local path (optional)'} value={icon} onChange={e=>setIcon(e.target.value)}/><button disabled={disabled||!name.trim()||stats.neutralObjectives.length>=6} onClick={()=>{update({...stats,neutralObjectives:[...stats.neutralObjectives,{id:crypto.randomUUID(),name:name.trim(),icon,blue:0,red:0}]});setName('');setIcon('');}}>{zh?'添加资源':'Add objective'}</button></div>
  </details>;
}
