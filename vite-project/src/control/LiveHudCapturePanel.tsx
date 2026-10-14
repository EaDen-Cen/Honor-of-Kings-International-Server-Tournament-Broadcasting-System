import { useEffect, useRef, useState } from 'react';
import type { Action, MatchState } from '../shared/types';
import { liveGameContext, trustedLiveUpdates, type LiveHudSample } from '../shared/liveGame';
import { liveCaptureLabel, liveCaptureRects, liveCaptureKeys, validLiveCaptureRects, type LiveCaptureKey, type CaptureRect } from '../shared/gameCapture';
import { LiveHudCalibration } from './LiveHudCalibration';
import './liveHudCalibration.css';
import { useGameDataCapture } from './useGameDataCapture';

interface Result extends LiveHudSample { context:string; elapsedMs:number }
export function LiveHudCapturePanel({state,zh,token,disabled,send}:{state:MatchState;zh:boolean;token:string;disabled:boolean;send:(action:Action)=>void}){
  const capture=useGameDataCapture(zh);
  const [regions,setRegions]=useState<Record<LiveCaptureKey,CaptureRect>>(()=>{
    try{const saved=JSON.parse(localStorage.getItem('hok-ghud-calibration-v1')||'null');return validLiveCaptureRects(saved)?saved:structuredClone(liveCaptureRects);}
    catch{return structuredClone(liveCaptureRects);}
  });
  const [calibrated,setCalibrated]=useState(false),[preview,setPreview]=useState(''),[calibrationField,setCalibrationField]=useState<LiveCaptureKey>('gameTimeSeconds');
  const [result,setResult]=useState<Result>(),[previous,setPrevious]=useState<Result>(),[auto,setAuto]=useState(false),[publish,setPublish]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const context=liveGameContext(state),signature=useRef(''),last=useRef<Result>(),running=useRef(false),epoch=useRef(0),stateRef=useRef(state);
  stateRef.current=state;signature.current=`${context}:${capture.generation.current}`;
  useEffect(()=>{epoch.current++;last.current=undefined;setResult(undefined);setPrevious(undefined);setAuto(false);setPublish(false);},[context]);
  function editRegions(next:Record<LiveCaptureKey,CaptureRect>){epoch.current++;last.current=undefined;setPrevious(undefined);setResult(undefined);setAuto(false);setPublish(false);setCalibrated(false);setRegions(next);}
  function confirmRegions(){
    if(!validLiveCaptureRects(regions)){setMessage(zh?'选框无效：检查七项不重叠、位置在画面内。':'Invalid seven-region calibration');return;}
    localStorage.setItem('hok-ghud-calibration-v1',JSON.stringify(regions));epoch.current++;last.current=undefined;setPrevious(undefined);setResult(undefined);setCalibrated(true);setMessage(zh?'采集位置已确认，请先手动采样两次核对 OCR。':'Calibration saved. Review two OCR readings manually before enabling automation.');
  }
  useEffect(()=>()=>{epoch.current++;},[]);
  async function sample(){
    if(running.current||disabled||!calibrated)return;
    running.current=true;setBusy(true);const version=epoch.current,current=signature.current;
    try{
      const canvas=capture.frame();
      const response=await fetch(`${(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')}/api/v1/recognition/live-hud`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({image:canvas.toDataURL('image/jpeg',.94),context,regions}),signal:AbortSignal.timeout(10000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      if(version!==epoch.current||current!==signature.current)return;
      const next=data as Result,prior=last.current;
      setPrevious(prior);setResult(next);last.current=next;
      const updates=prior?trustedLiveUpdates(stateRef.current.liveGameStats,prior,next):{};
      if(publish&&calibrated&&!capture.isStill&&prior&&Object.keys(updates).length)send({type:'live_game_ocr',context,previous:prior,sample:next});
      setMessage(prior?(zh?'两次采样已比较；冲突、低置信度、异常跳变和冻结字段保持原值。':'Samples compared; conflicting, weak, implausible and frozen fields retain their values.'):(zh?'首帧仅作候选，请再次采样以核验。':'First read is a candidate; sample again to verify.'));
    }catch(e){
      if(version===epoch.current){last.current=undefined;setPrevious(undefined);setMessage(e instanceof Error?e.message:'Capture failed');}
    }finally{running.current=false;setBusy(false);}
  }
  const sampleRef=useRef(sample);sampleRef.current=sample;
  useEffect(()=>{
    last.current=undefined;setPrevious(undefined);setResult(undefined);
    setAuto(false);setPublish(false);setCalibrated(false);setPreview('');
  },[capture.sourceVersion]);
  useEffect(()=>{
    if(!auto||!calibrated||disabled||!capture.ready||capture.isStill)return;
    const timer=window.setInterval(()=>void sampleRef.current(),5000);
    void sampleRef.current();return()=>window.clearInterval(timer);
  },[auto,calibrated,disabled,capture.ready,capture.isStill]);
  const updates=result&&previous?trustedLiveUpdates(state.liveGameStats,previous,result):{};
  return <details className="panel"><summary>{zh?'GHUD 顶栏识别 · Experimental':'GHUD top bar recognition · Experimental'}</summary>
    <p className="muted">{zh?'读取游戏时间、双方人头、经济与推塔。先采样两次核验，再应用或开启自动播出。人工改值会冻结对应字段。断流时保留最后可信值；截图仅用于审核。':'Reads time, kills, gold and towers. Verify two reads before applying or enabling automatic output. Manual edits freeze fields. Lost capture retains trusted values; screenshots are for review.'}</p>
    {capture.controls}
    <LiveHudCalibration zh={zh} regions={regions} onRegionsChange={editRegions} selected={calibrationField} onSelectedChange={setCalibrationField} preview={preview} onPreview={()=>{
      try{setPreview(capture.frame().toDataURL('image/jpeg',.88));setMessage('');}catch(e){setMessage(e instanceof Error?e.message:'Capture not ready');}
    }} ready={capture.ready} onConfirm={confirmRegions} calibrated={calibrated}/>
    <div className="toolbar"><button disabled={disabled||busy||!capture.ready||!calibrated} onClick={()=>void sample()}>{busy?(zh?'采样中…':'Sampling…'):(zh?'采样 GHUD':'Sample GHUD')}</button>
      <label><input type="checkbox" checked={auto} disabled={disabled||!calibrated||capture.isStill} onChange={e=>{epoch.current++;setAuto(e.target.checked);if(!e.target.checked)setPublish(false);}}/>{zh?'每 5 秒自动采样':'Sample every 5 seconds'}</label>
      <label><input type="checkbox" checked={publish} disabled={disabled||!calibrated||!auto||capture.isStill} onChange={e=>{epoch.current++;setPublish(e.target.checked);}}/>{zh?'自动播出两帧核验字段':'Publish fields verified by two reads'}</label>
      <button disabled={disabled||!calibrated||capture.isStill||!Object.keys(updates).length} onClick={()=>{if(previous&&result)send({type:'live_game_ocr',context,previous,sample:result});}}>{zh?'应用已核验字段':'Apply verified fields'}</button>
    </div>
    {result&&<div className="post-game-table">{result.candidates.map(c=><div className="toolbar" key={c.key}><b>{liveCaptureLabel(c.key,zh)}</b><span>{c.value??'—'} · {Math.round(c.confidence*100)}% · OCR: {c.text||'—'}</span><small className={updates[c.key]===undefined?'error':''}>{updates[c.key]!==undefined?(zh?'两帧一致':'Verified in two reads'):(zh?'待核验 / 保留原值':'Pending / existing value kept')}</small></div>)}</div>}
    <p role="status">{message}</p>
  </details>;
}
