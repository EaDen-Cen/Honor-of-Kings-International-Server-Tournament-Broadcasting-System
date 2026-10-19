import { createClientUUID } from '../shared/clientId';
import { useEffect,useRef,useState } from 'react';
import type { Action,MatchState } from '../shared/types';
import type { LiveGameStats } from '../shared/liveGame';
import { liveCaptureKeys, liveCaptureLabel } from '../shared/gameCapture';
import { LiveHudCapturePanel } from './LiveHudCapturePanel';
import { ManualNumberInput } from './ManualNumberInput';
export function LiveGamePanel({state,token,disabled,send}:{state:MatchState;token:string;disabled:boolean;send:(action:Action)=>void}){
  const zh=state.language==='zh',stats=state.liveGameStats;
  const [name,setName]=useState(''),[icon,setIcon]=useState('');
  const pendingObjective=useRef<{id:string;name:string;icon:string}>();
  const gameKey=`${state.draftGameNumber??state.gameNumber}:${state.committedGameId??''}`;
  useEffect(()=>{
    const pending=pendingObjective.current;
    if(pending&&stats.neutralObjectives.some(item=>item.id===pending.id)){
      setName(current=>current===pending.name?'':current);setIcon(current=>current===pending.icon?'':current);pendingObjective.current=undefined;
    }
  },[stats.neutralObjectives]);
  const update=(value:LiveGameStats)=>send({type:'live_game_stats',stats:value});
  const counter=(key:'blueKills'|'redKills'|'blueTowers'|'redTowers',label:string)=><div className="toolbar" key={key}><span>{label}</span>
    <button disabled={disabled||stats[key]===0} aria-label={`${key} minus`} onClick={()=>update({...stats,[key]:stats[key]-1})}>−</button>
    <ManualNumberInput key={`${gameKey}:${key}`} label={key} zh={zh} min={0} max={999} value={stats[key]} disabled={disabled} onCommit={value=>update({...stats,[key]:value!})}/>
    <button disabled={disabled||stats[key]===999} aria-label={`${key} plus`} onClick={()=>update({...stats,[key]:stats[key]+1})}>+</button></div>;
  return <details className="panel"><summary>{zh?'局内 HUD / 人头、推塔与资源':'Live HUD / kills, towers and objectives'}</summary>
    <p className="muted">{zh?'OBS 浏览器源：/overlay/game-hud，1920×1080。所有变更支持顶部撤销。':'OBS Browser Source: /overlay/game-hud, 1920×1080. Use Undo to revert changes.'}</p>
    <LiveHudCapturePanel state={state} zh={zh} token={token} disabled={disabled} send={send}/>
    <p className="muted">{zh?'数字输完后按 Enter 或离开输入框保存；Esc 放弃当前修改。经济和时间留空可隐藏未知数据。人工修改会冻结该项，取消冻结后恢复自动识别。':'Press Enter or leave a number field to save; Esc discards your edit. Clear gold or time to hide unknown data. Manual edits freeze the field; unfreeze it to resume OCR.'}</p>
    <div className="lineup-team-grid">{(['blue','red'] as const).map(side=><div key={side}><b>{state[`${side}Team`].name}</b>{counter(`${side}Kills`,zh?'人头':'Kills')}{counter(`${side}Towers`,zh?'推塔':'Towers')}</div>)}</div>
    <div className="toolbar">{(['blueGold','redGold','gameTimeSeconds'] as const).map(key=><label key={key}>{liveCaptureLabel(key,zh)}<ManualNumberInput key={`${gameKey}:${key}`} label={key} zh={zh} min={0} max={key==='gameTimeSeconds'?7200:1000000} value={stats[key]} disabled={disabled} allowEmpty onCommit={value=>update({...stats,[key]:value})}/></label>)}</div>
    <div className="toolbar">{liveCaptureKeys.map(key=><label key={key}><input type="checkbox" checked={stats.sources?.[key]?.source==='manual'} disabled={disabled} onChange={e=>send({type:'live_game_freeze',key,frozen:e.target.checked})}/>{liveCaptureLabel(key,zh)} · {zh?'冻结（取消恢复自动）':'Freeze (uncheck to resume automatic)'}</label>)}</div>
    <label>{zh?'密度':'Density'} <select value={stats.density} disabled={disabled} onChange={e=>update({...stats,density:e.target.value as 'compact'|'full'})}><option value="compact">{zh?'简约 · 顶栏 99px':'Compact · 99px top'}</option><option value="full">{zh?'完整 · 顶栏 131px':'Full · 131px top'}</option></select></label>
    {stats.neutralObjectives.map(item=><div className="toolbar" key={item.id}><b>{item.name}</b>{(['blue','red'] as const).map(side=><label key={side}>{state[`${side}Team`].name}<ManualNumberInput key={`${gameKey}:${item.id}:${side}`} label={`${item.name} ${side}`} zh={zh} min={0} max={999} value={item[side]} disabled={disabled} onCommit={value=>update({...stats,neutralObjectives:stats.neutralObjectives.map(v=>v.id===item.id?{...v,[side]:value!}:v)})}/></label>)}<button disabled={disabled} onClick={()=>update({...stats,neutralObjectives:stats.neutralObjectives.filter(v=>v.id!==item.id)})}>{zh?'移除':'Remove'}</button></div>)}
    <form className="toolbar" onSubmit={event=>{
      event.preventDefault();if(disabled||!name.trim()||stats.neutralObjectives.length>=6)return;
      const id=createClientUUID();pendingObjective.current={id,name,icon};
      update({...stats,neutralObjectives:[...stats.neutralObjectives,{id,name:name.trim(),icon:icon.trim(),blue:0,red:0}]});
    }}><input aria-label="Objective name" placeholder={zh?'资源名称':'Objective name'} maxLength={24} value={name} disabled={disabled} onChange={e=>setName(e.target.value)}/><input aria-label="Objective icon" placeholder={zh?'图标 HTTPS/本地路径（可选）':'Icon HTTPS/local path (optional)'} maxLength={1000} value={icon} disabled={disabled} onChange={e=>setIcon(e.target.value)}/><button type="submit" disabled={disabled||!name.trim()||stats.neutralObjectives.length>=6}>{zh?'添加资源':'Add objective'}</button></form>
  </details>;
}
