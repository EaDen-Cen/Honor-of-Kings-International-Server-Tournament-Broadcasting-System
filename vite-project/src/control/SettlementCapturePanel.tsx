import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureRequest } from './captureRequest';
import type { Action, Side } from '../shared/types';
import { canMergePostGameField, postGameMetricLabel, postGameTeamMetricLabel, type PostGameMetric, type PostGamePage, type PostGameReport, type PostGameTeamMetric } from '../shared/postGame';
import { settlementPages, settlementPageLabel, type NumericCandidate } from '../shared/gameCapture';
import { mergeSettlementIdentityMapping } from '../shared/settlementIdentity';
import { frameDifference, frameFingerprint, framePageHint, useGameDataCapture } from './useGameDataCapture';
import { hasPostGameFieldUpdate } from './postGameUpdates';

interface SettlementResult {
  page:PostGamePage; reportId:string; capturedAt:number; evidence:string; elapsedMs:number;
  rows:Array<{screenRow:number; text:string; rowId:string|null; suggestedRowId:string|null}>;
  candidates:Array<NumericCandidate&{screenRow:number;metric:PostGameMetric}>;
  teamCandidates?:Array<NumericCandidate&{side:'left'|'right';metric:PostGameTeamMetric}>;
}
function readMapping(reportId:string){try{const value=JSON.parse(localStorage.getItem('hok-settlement-mapping-v1:'+reportId)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,string>:{};}catch{return {};}}
export function SettlementCapturePanel({report,zh,token,disabled,send}:{report:PostGameReport;zh:boolean;token:string;disabled:boolean;send:(action:Action)=>void}){
  const capture=useGameDataCapture(zh),[page,setPage]=useState<PostGamePage|'auto'>('auto'),[results,setResults]=useState<Partial<Record<PostGamePage,SettlementResult>>>({}),[selected,setSelected]=useState<PostGamePage>('overview');
  const [mapping,setMapping]=useState<Record<string,string>>(()=>readMapping(report.id)),[busy,setBusy]=useState(false),[auto,setAuto]=useState(false),[message,setMessage]=useState('');
  const [recapLeft,setRecapLeft]=useState<Side|''>('');
  const active=useRef(''),running=useRef(false),epoch=useRef(0);
  const pending=useRef(new CaptureRequest());
  const cancelCapture=useCallback(()=>{epoch.current++;pending.current.cancel();running.current=false;setBusy(false);},[]);
  active.current=JSON.stringify([report.id,page,capture.generation.current,disabled,token]);
  useEffect(()=>{setResults({});setMapping(readMapping(report.id));setRecapLeft('');setAuto(false);cancelCapture();},[report.id,cancelCapture]);
  useEffect(()=>{cancelCapture();},[page,capture.sourceVersion,disabled,token,cancelCapture]);
  useEffect(()=>{localStorage.setItem('hok-settlement-mapping-v1:'+report.id,JSON.stringify(mapping));},[report.id,mapping]);
  useEffect(()=>{const request=pending.current;return()=>{request.cancel();};},[]);
  async function recognize(canvas:HTMLCanvasElement){
    if(running.current||disabled)return false;
    running.current=true;setBusy(true);const signature=active.current,version=epoch.current,source=capture.generation.current,request=pending.current.start(30000);
    try{
      const response=await fetch(`${(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')}/api/v1/recognition/settlement`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({image:canvas.toDataURL('image/jpeg',.94),reportId:report.id,page}),signal:request.signal});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      if(!request.isCurrent()||request.signal.aborted||active.current!==signature||epoch.current!==version||source!==capture.generation.current)return false;
      const data=result as SettlementResult;
      setResults(old=>({...old,[data.page]:data}));setSelected(data.page);
      setMapping(old=>mergeSettlementIdentityMapping(old,data.rows));
      setMessage(zh?`已采集${settlementPageLabel(data.page,true)}页；请核对身份及数字后应用。`:`Captured ${data.page}; review identities and values before applying.`);
      return true;
    }catch(e){if(request.isCurrent()&&epoch.current===version&&active.current===signature&&source===capture.generation.current)setMessage(request.signal.reason instanceof Error?request.signal.reason.message:e instanceof Error?e.message:'Capture failed');return false;}
    finally{if(request.finish()){running.current=false;setBusy(false);}}
  }
  const recognizeRef=useRef(recognize);recognizeRef.current=recognize;
  const captureRef=useRef(capture);captureRef.current=capture;
  useEffect(()=>{
    if(!auto||!capture.ready||capture.isStill||disabled)return;
    let previous:Uint8ClampedArray|undefined,submitted:Uint8ClampedArray|undefined,count=0,source=captureRef.current.generation.current,tab=-1,submittedTab=-1,lastAttempt=0;
    const timer=window.setInterval(()=>{
      if(running.current)return;
      if(source!==captureRef.current.generation.current){source=captureRef.current.generation.current;previous=undefined;submitted=undefined;count=0;}
      try{
        const frame=captureRef.current.frame(),fingerprint=frameFingerprint(frame),hint=framePageHint(frame);
        count=previous&&tab===hint&&frameDifference(previous,fingerprint)<1.5?count+1:0;previous=fingerprint;tab=hint;
        if(count>=2&&Date.now()-lastAttempt>5000&&(!submitted||submittedTab!==hint||frameDifference(submitted,fingerprint)>3)){
          lastAttempt=Date.now();void recognizeRef.current(frame).then(ok=>{if(ok){submitted=fingerprint;submittedTab=hint;}});
        }
      }catch{setAuto(false);setMessage(zh?'采集已停止，请重新选择窗口。':'Capture stopped; choose a window again.');}
    },600);
    return()=>window.clearInterval(timer);
  },[auto,capture.ready,capture.isStill,disabled,zh,page]);
  const result=results[selected];
  const mappings=result?.rows.map(row=>mapping[String(row.screenRow)]||'')??[];
  const complete=mappings.length===10&&mappings.every(Boolean)&&new Set(mappings).size===10&&mappings.every((id,index)=>report.players.some(p=>p.rowId===id&&p.side===(index<5?'blue':'red')));
  const updates=result?.candidates.filter(c=>c.value!==null&&c.confidence>=.85).map(c=>({rowId:mappings[c.screenRow],metric:c.metric,field:{value:c.value!,confidence:c.confidence,manual:false,sourcePage:result.page,evidence:result.evidence,capturedAt:result.capturedAt}})).filter(update=>{
    const player=report.players.find(player=>player.rowId===update.rowId);
    return !!player&&hasPostGameFieldUpdate(player.fields[update.metric],update.field);
  })??[];
  return <details className="panel" open><summary>{zh?'结算整页采集 · 实机模板':'Full-page settlement capture · game template'}</summary>
    <p className="muted">{zh?'同一局十行身份映射跨所有结算页复用，首次核对即可；发现页面行序变化时请人工修改。对局页仍须确认左右队伍。评分可在下方单独补录；经济曲线通过时间点导入。':'One ten-row identity mapping is shared across settlement pages; review once, adjust only if the order changes. Confirm recap sides separately. Rating can be entered below; gold trends use time-series samples.'}</p>
    {capture.controls}
    <div className="toolbar"><label>{zh?'页面类型':'Page type'}<select aria-label="Settlement page type" value={page} onChange={e=>{cancelCapture();setPage(e.target.value as PostGamePage|'auto');}}><option value="auto">{zh?'自动判页':'Detect automatically'}</option>{settlementPages.map(p=><option key={p} value={p}>{settlementPageLabel(p,zh)}</option>)}</select></label>
      <button disabled={disabled||busy||!capture.ready} onClick={()=>{try{void recognize(capture.frame());}catch(e){setMessage(String(e));}}}>{busy?(zh?'整页识别中…':'Reading page…'):(zh?'采集整页':'Capture full page')}</button>
      <label><input type="checkbox" checked={auto} disabled={disabled||capture.isStill} onChange={e=>{cancelCapture();setAuto(e.target.checked);}}/>{zh?'稳定画面后自动采集草稿':'Collect drafts when frames stabilize'}</label>
    </div>
    <div className="toolbar">{settlementPages.map(p=><button disabled={!results[p]} key={p} onClick={()=>setSelected(p)}>{settlementPageLabel(p,zh)} {results[p]?'✓':'—'}</button>)}</div>
    {result&&<><p className="muted">{zh?'本局统一选手顺序：第一次确认后，切换输出、生存、经济等页不必重复选择。':'Shared player order for this game: no remapping needed on each page.'}</p><p>{Math.round(result.elapsedMs)} ms · <a href={result.evidence} target="_blank" rel="noreferrer">{zh?'整页原图证据':'Page evidence'}</a></p>
      {result.page==='recap'&&<><label>{zh?'对局页左侧「我方」对应':'Recap left / friendly side maps to'}<select aria-label="Recap left side" value={recapLeft} onChange={e=>setRecapLeft(e.target.value as Side|'')}><option value="">{zh?'请确认队伍':'Confirm team'}</option>{(['blue','red'] as const).map(side=><option value={side} key={side}>{report.players.find(p=>p.side===side)?.teamName} ({side})</option>)}</select></label>
        <div className="post-game-table">{result.teamCandidates?.map(c=>{
          const side=recapLeft?(c.side==='left'?recapLeft:recapLeft==='blue'?'red':'blue'):null,stored=side?report.teamFields?.[side]?.[c.metric]:undefined;
          return <div className="toolbar" key={`${c.side}:${c.metric}`}><b>{c.side} · {postGameTeamMetricLabel(c.metric,zh)}</b><span className={c.value===null||c.confidence<.85?'error':''}>{c.value??'—'} ({Math.round(c.confidence*100)}%)</span>{side&&<input aria-label={`Recap ${side} ${c.metric}`} type="number" min={0} max={c.metric==='gold'?1000000:999} disabled={disabled} key={`${side}:${c.metric}:${stored?.value}`} defaultValue={stored?.value??''} placeholder={zh?'人工修正':'Manual correction'} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==stored?.value)send({type:'post_game_team_fields',reportId:report.id,updates:[{side,metric:c.metric,field:{value:Number(e.target.value),confidence:1,manual:true,sourcePage:'recap'}}]});}}/>}</div>;
        })}</div>
        <button disabled={disabled||!recapLeft||!result.teamCandidates?.some(c=>c.value!==null&&c.confidence>=.85)} onClick={()=>{if(!recapLeft)return;send({type:'post_game_team_fields',reportId:report.id,updates:result.teamCandidates!.filter(c=>c.value!==null&&c.confidence>=.85).map(c=>({side:c.side==='left'?recapLeft:recapLeft==='blue'?'red':'blue',metric:c.metric,field:{value:c.value!,confidence:c.confidence,manual:false,sourcePage:'recap',capturedAt:result.capturedAt,evidence:result.evidence}}))});}}>{zh?'应用已核对队伍汇总':'Apply reviewed team recap'}</button>
      </>}
      <div className="post-game-table">{result.rows.map(row=>{
        const rowId=mappings[row.screenRow],player=report.players.find(p=>p.rowId===rowId),side=row.screenRow<5?'blue':'red';
        return <div key={row.screenRow} className="panel"><label>{side} · {zh?'画面第':'Screen row '}{row.screenRow%5+1} · OCR: {row.text||'—'} {row.rowId&&rowId&&row.rowId!==rowId&&<small className="error">{zh?'本页 OCR 与已保存排序不同，请核实':'This page OCR differs from the saved order; review'}</small>} <select aria-label={`Settlement identity ${row.screenRow}`} value={rowId} disabled={disabled} onChange={e=>setMapping(old=>({...old,[String(row.screenRow)]:e.target.value}))}><option value="">{zh?'请确认对应选手':'Confirm player identity'}</option>{report.players.filter(p=>p.side===side).map(p=><option value={p.rowId} key={p.rowId}>{p.teamName} · {p.playerId||`P${p.slot+1}`}</option>)}</select></label>
          <div className="toolbar">{result.candidates.filter(c=>c.screenRow===row.screenRow).map(c=><span key={c.metric} className={c.value===null||c.confidence<.85?'error':''}>{postGameMetricLabel(c.metric,zh)}: {c.value??'—'} ({Math.round(c.confidence*100)}%){player&&c.value!==null&&!canMergePostGameField(player.fields[c.metric],{value:c.value,confidence:c.confidence,manual:false,sourcePage:selected})&&<small> · {zh?'保留已有值':'Existing value protected'}</small>}</span>)}</div>
        </div>;
      })}</div>
      {result.page!=='recap'&&<><button disabled={disabled||!complete||!updates.length} onClick={()=>{send({type:'post_game_fields',reportId:report.id,updates});setMessage(zh?'已提交高置信度字段；冲突和人工值保留，可在下方逐字段修正。':'High-confidence fields submitted; protected conflicts remain. Edit individual fields below.');}}>{zh?'应用本页已核对的高置信度字段':'Apply reviewed high-confidence fields'}</button>
        {!complete&&<p className="error">{zh?'必须确认同队五人一一对应，不能重复绑定选手。':'Confirm a unique five-player mapping for each team.'}</p>}</>}
    </>}
    <p role="status">{message}</p>
  </details>;
}
