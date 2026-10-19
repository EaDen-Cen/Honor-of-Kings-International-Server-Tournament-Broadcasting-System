import { playerAtSlot } from '../shared/playerSlots';
import { apiURL } from '../shared/config';
import { useCallback, useEffect, useRef, useState } from 'react';
import { heroForState } from '../shared/heroData';
import type { Action, MatchState, Side } from '../shared/types';
import {
  defaultCaptureSlots,
  normalizeCaptureSlots,
  type CaptureSlotKey,
  type CaptureSlots,
} from './bpCaptureLayout';
import { regionToPixels, type NormalizedCaptureRegion } from './windowCaptureGeometry';
import {
  getSharedWindowCaptureStream,
  connectSharedBpWindow,
  subscribeSharedWindowCapture,
} from './sharedWindowCapture';
import { solveLineupTeam as solveTeam, type Candidate, type SlotResult } from './lineupRecognition';
import { lineupIdentityContext, lineupWriteContext } from '../shared/lineupContext';
import type { MatchActionFeedback } from '../shared/useMatch';
import { lineupTargetMatches, reconcileLineupSubmission, reviewedLineupTarget, trustedLineup, validLineupOrder, type LineupCandidate, type LineupSubmission, type LineupTarget } from './lineupConfirmation';

const SLOTS_STORAGE='hok-window-capture-slots-v3';

function readCaptureSlots():CaptureSlots {
  try {
    const stored=JSON.parse(localStorage.getItem(SLOTS_STORAGE)||'null');
    if(stored&&typeof stored==='object') return normalizeCaptureSlots(stored);
  } catch { /* use defaults */ }
  return normalizeCaptureSlots(defaultCaptureSlots);
}

function label(state:MatchState,id:number|null|undefined) {
  if(!id) return '—';
  const hero=heroForState(state,id);
  return state.language==='zh'?hero?.chineseName??'—':hero?.englishName??'—';
}

function pickKey(side:Side,index:number) {
  return `${side}Pick${index+1}` as CaptureSlotKey;
}

async function mapWithConcurrency<T,R>(
  items:T[],
  limit:number,
  worker:(item:T)=>Promise<R>,
):Promise<R[]> {
  const output=new Array<R>(items.length);
  let cursor=0,failed=false;
  const runners=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!failed){
      const index=cursor++;
      if(index>=items.length) return;
      try{output[index]=await worker(items[index]);}
      catch(error){failed=true;throw error;}
    }
  });
  await Promise.all(runners);
  return output;
}

function captureFrame(video:HTMLCanvasElement,region:NormalizedCaptureRegion) {
  const pixels=regionToPixels(region,video.width,video.height);
  const maxSide=256;
  const scale=Math.min(1,maxSide/Math.max(pixels.width,pixels.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(32,Math.round(pixels.width*scale));
  canvas.height=Math.max(32,Math.round(pixels.height*scale));
  const context=canvas.getContext('2d');
  if(!context) throw new Error('Canvas unavailable');
  context.imageSmoothingEnabled=true;
  context.imageSmoothingQuality='high';
  context.drawImage(video,pixels.x,pixels.y,pixels.width,pixels.height,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.94);
}

export function LineupAssignments({state,revision,token,disabled,send,actionFeedback}:{
  state:MatchState;revision:number;token:string;disabled:boolean;
  send:(action:Action)=>string|undefined;actionFeedback?:MatchActionFeedback;
}) {
  const zh=state.language==='zh';
  const [auto,setAuto]=useState(()=>{try{return localStorage.getItem('hok-lineup-auto')!=='0';}catch{return true;}});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[blocked,setBlocked]=useState('');
  const [candidate,setCandidate]=useState<LineupCandidate>(),[submission,setSubmission]=useState<LineupSubmission>();
  const [videoReady,setVideoReady]=useState(false),[streamLabel,setStreamLabel]=useState(''),[connecting,setConnecting]=useState(false);
  const [slots,setSlots]=useState(readCaptureSlots),[clock,setClock]=useState(0);
  const videoRef=useRef<HTMLVideoElement>(null),streamRef=useRef<MediaStream>(),mounted=useRef(false);
  const activeScan=useRef<AbortController>(),captureRequest=useRef<AbortController>(),scanVersion=useRef(0);
  const candidateRef=useRef(candidate),submissionRef=useRef(submission),attempted=useRef(new Set<string>()),stoppedFailure=useRef<string>();
  candidateRef.current=candidate;submissionRef.current=submission;
  const latest=useRef({state,revision,token,disabled,send,auto,slots});latest.current={state,revision,token,disabled,send,auto,slots};
  const identity=lineupIdentityContext(state),writeContext=lineupWriteContext(state),calibration=JSON.stringify(slots);
  const previousContext=useRef({identity,writeContext,token,calibration});
  const stopScan=useCallback(()=>{
    scanVersion.current++;activeScan.current?.abort();activeScan.current=undefined;setBusy(false);
  },[]);
  const saveCandidate=useCallback((next:LineupCandidate|undefined)=>{candidateRef.current=next;setCandidate(next);},[]);
  const pauseAuto=useCallback(()=>{
    stopScan();setAuto(false);latest.current.auto=false;
    try{localStorage.setItem('hok-lineup-auto','0');}catch{/* Session preference still applies. */}
  },[stopScan]);

  useEffect(()=>{
    const previous=previousContext.current;
    previousContext.current={identity,writeContext,token,calibration};
    const changedIdentity=previous.identity!==identity||previous.token!==token||previous.calibration!==calibration;
    if(changedIdentity){
      stopScan();saveCandidate(undefined);attempted.current.clear();setBlocked('');
      setSubmission(old=>old?{...old,phase:'expired',error:'Lineup context changed; scan again'}:undefined);
      setMessage(zh?'本局、选手顺序或校准已变化，请重新识别最终归属。':'Game, player order or calibration changed; scan the final lineup again.');
    }else if(previous.writeContext!==writeContext){
      stopScan();
      const own=submissionRef.current;
      if(!own||own.identityContext!==identity||!lineupTargetMatches(own.target,state)){
        saveCandidate(undefined);pauseAuto();setBlocked('');
        setSubmission(old=>old?{...old,phase:'expired',error:'Saved lineup changed; scan again before retrying'}:undefined);
        setMessage(zh?'已保存阵容被人工或外部操作更改，旧识别已作废并暂停自动同步。':'Saved lineup changed manually or externally. Previous readings were discarded and automatic sync paused.');
      }
    }
  },[identity,writeContext,token,calibration,state,zh,stopScan,saveCandidate,pauseAuto]);
  // A pending match write pauses OCR, not the visible candidate or its outcome.
  useEffect(()=>{if(disabled)stopScan();},[disabled,stopScan]);
  useEffect(()=>{
    setSubmission(old=>{
      if(!old)return old;
      const next=reconcileLineupSubmission(old,state,revision,actionFeedback);
      return JSON.stringify(old)===JSON.stringify(next)?old:next;
    });
  },[state,revision,actionFeedback,clock]);
  useEffect(()=>{
    if(!submission||(submission.phase!=='rejected'&&submission.phase!=='unconfirmed')||stoppedFailure.current===submission.id)return;
    stoppedFailure.current=submission.id;
    pauseAuto();
  },[submission,pauseAuto]);
  useEffect(()=>{
    if(submission?.phase!=='submitting')return;
    const timer=setInterval(()=>setClock(value=>value+1),250);
    return()=>clearInterval(timer);
  },[submission?.phase]);

  const attachStream=useCallback(async(stream:MediaStream|undefined)=>{
    const changed=streamRef.current!==stream;
    if(changed){stopScan();saveCandidate(undefined);attempted.current.clear();}
    streamRef.current=stream;
    const video=videoRef.current;setVideoReady(false);
    if(!video)return;
    video.srcObject=stream??null;
    if(!stream){setStreamLabel('');return;}
    try{
      await video.play();
      if(mounted.current&&streamRef.current===stream&&video.srcObject===stream){
        setStreamLabel(stream.getVideoTracks()[0]?.label||'BP window');setVideoReady(!!video.videoWidth&&!!video.videoHeight);
      }
    }catch{/* Source ended or was replaced. */}
  },[stopScan,saveCandidate]);
  useEffect(()=>{
    mounted.current=true;
    const video=videoRef.current;
    void attachStream(getSharedWindowCaptureStream());
    const unsubscribe=subscribeSharedWindowCapture(stream=>void attachStream(stream));
    const refresh=()=>{stopScan();saveCandidate(undefined);setSlots(readCaptureSlots());};
    const resize=()=>{
      stopScan();saveCandidate(undefined);
      setVideoReady(!!video?.videoWidth&&!!video.videoHeight&&!!streamRef.current?.getVideoTracks().some(track=>track.readyState==='live'));
    };
    video?.addEventListener('resize',resize);window.addEventListener('hok-capture-slots-changed',refresh);
    const selecting=captureRequest,scanning=activeScan;
    return()=>{
      mounted.current=false;unsubscribe();video?.removeEventListener('resize',resize);window.removeEventListener('hok-capture-slots-changed',refresh);
      selecting.current?.abort();scanning.current?.abort();if(video)video.srcObject=null;
    };
  },[attachStream,stopScan,saveCandidate]);
  const connectWindow=useCallback(async()=>{
    if(captureRequest.current||latest.current.disabled)return;
    if(!navigator.mediaDevices?.getDisplayMedia){setMessage(zh?'当前浏览器不支持窗口采集。':'Window capture is not supported by this browser.');return;}
    const controller=new AbortController();captureRequest.current=controller;setConnecting(true);
    try{await connectSharedBpWindow(false,controller.signal);}
    catch{if(mounted.current&&!controller.signal.aborted)setMessage(zh?'未连接 BP 窗口，仍可人工核对最终归属。':'BP window was not connected; review the final lineup manually.');}
    finally{if(captureRequest.current===controller)captureRequest.current=undefined;if(mounted.current)setConnecting(false);}
  },[zh]);

  const submitTarget=useCallback((target:LineupTarget,automatic=false,key?:string,recognition=false)=>{
    const current=latest.current;
    if(automatic&&key){if(attempted.current.has(key))return;attempted.current.add(key);}
    if(current.disabled||!current.state.draftComplete||current.state.committedGameId){
      pauseAuto();
      setBlocked(current.state.language==='zh'?'未提交：连接未就绪或有操作正在确认，请稍后人工重试。':'Not submitted: connection unavailable or another action is pending. Retry manually.');return;
    }
    if(!validLineupOrder(target.blue,current.state.bluePicks)||!validLineupOrder(target.red,current.state.redPicks)){
      pauseAuto();
      setBlocked(current.state.language==='zh'?'未提交：最终英雄必须与本队五个 Pick 一一对应。':'Not submitted: final heroes must match each team’s five picks uniquely.');return;
    }
    if(lineupTargetMatches(target,current.state)){
      setMessage(current.state.language==='zh'?'已保存阵容与提案相同，本次没有发送写入。':'Saved lineup already matches this proposal; no write was sent.');return;
    }
    stopScan();setBlocked('');
    const expectedContext=lineupWriteContext(current.state),identityContext=lineupIdentityContext(current.state);
    const id=current.send({type:'set_lineup_assignments',blue:[...target.blue],red:[...target.red],expectedContext});
    if(!id){pauseAuto();setBlocked(current.state.language==='zh'?'未提交：服务器通道尚未就绪，候选已保留。请连接后人工重试。':'Not submitted: server channel is not ready. Candidate retained; reconnect and retry manually.');return;}
    const next:LineupSubmission={id,target:{blue:[...target.blue],red:[...target.red]},identityContext,expectedContext,baseRevision:current.revision,submittedAt:Date.now(),phase:'submitting',origin:automatic||recognition?'recognition':'manual'};
    submissionRef.current=next;setSubmission(next);
  },[stopScan,pauseAuto]);

  const scan=useCallback(async(forceApply=false)=>{
    const current=latest.current;
    if(activeScan.current||current.disabled||!current.state.draftComplete||current.state.committedGameId||current.state.bpInputMode!=='screen'||submissionRef.current?.phase==='submitting')return;
    const video=videoRef.current,source=streamRef.current;
    if(!video?.videoWidth||!video.videoHeight||!source?.getVideoTracks().some(track=>track.readyState==='live'))return;
    const controller=new AbortController(),version=++scanVersion.current;
    activeScan.current=controller;setBusy(true);
    const capturedContext=lineupWriteContext(current.state),capturedIdentity=lineupIdentityContext(current.state);
    const timeout=setTimeout(()=>controller.abort(),25000);
    try{
      const frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d')!.drawImage(video,0,0);
      const work=(['blue','red'] as const).flatMap(side=>Array.from({length:5},(_,index)=>({side,index})));
      const scanned=await mapWithConcurrency(work,2,async({side,index})=>{
        controller.signal.throwIfAborted();
        const image=captureFrame(frame,current.slots[pickKey(side,index)]);
        const response=await fetch(`${apiURL}/api/recognize-frame`,{method:'POST',headers:{Authorization:`Bearer ${current.token}`,'Content-Type':'application/json'},body:JSON.stringify({image,revision:current.revision,allowedHeroIds:current.state[`${side}Picks`],shape:'square'}),signal:controller.signal});
        const data=await response.json();if(!response.ok)throw new Error(data.error||(zh?'换英雄识别失败。':'Hero-swap recognition failed.'));
        return {side,playerIndex:index,preview:data.preview as string,candidates:(data.candidates??[]) as Candidate[]} satisfies SlotResult;
      });
      if(!mounted.current||controller.signal.aborted||version!==scanVersion.current||streamRef.current!==source||capturedContext!==lineupWriteContext(latest.current.state))return;
      const blue=solveTeam(scanned.filter(row=>row.side==='blue'),current.state.bluePicks),red=solveTeam(scanned.filter(row=>row.side==='red'),current.state.redPicks);
      const signature=JSON.stringify([blue?.heroes??null,red?.heroes??null]),previous=candidateRef.current;
      const next:LineupCandidate={results:scanned,blue,red,identityContext:capturedIdentity,writeContext:capturedContext,signature,stableCount:previous?.writeContext===capturedContext&&previous.signature===signature?previous.stableCount+1:1};
      saveCandidate(next);
      setBlocked('');
      setSubmission(old=>old&&(old.phase==='expired'||forceApply&&(old.phase==='rejected'||old.phase==='unconfirmed'))?undefined:old);
      const target=reviewedLineupTarget(next,latest.current.state),changed=target&&!lineupTargetMatches(target,latest.current.state);
      // A previous successful swap does not confirm a different newly read
      // proposal. Its first frame must return to detection/review status.
      if(submissionRef.current?.phase==='applied'&&(!target||changed)){
        submissionRef.current=undefined;setSubmission(undefined);
      }
      if(target&&changed&&!latest.current.disabled&&(forceApply||latest.current.auto&&next.stableCount>=2)){
        submitTarget(target,!forceApply,`${capturedContext}:${signature}`,true);
      }else if(!trustedLineup(blue)||!trustedLineup(red)){
        setMessage(zh?'候选已保留；至少一队不满足唯一匹配或相似度门槛，等待人工核对。':'Candidate retained. At least one team fails uniqueness or similarity thresholds; review it manually.');
      }else if(!changed){setMessage(zh?'识别与已保存阵容一致，本次没有写入。':'Recognition matches the saved lineup; no write was sent.');}
    }catch(error){
      if(mounted.current&&version===scanVersion.current&&!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Capture failed');
      else if(mounted.current&&version===scanVersion.current)setMessage(zh?'识别超时，已有候选保留，可人工接管或重试。':'Recognition timed out. Existing candidates are retained for manual takeover or retry.');
    }finally{clearTimeout(timeout);controller.abort();if(activeScan.current===controller){activeScan.current=undefined;if(mounted.current)setBusy(false);}}
  },[saveCandidate,submitTarget,zh]);
  useEffect(()=>{
    if(!auto||!videoReady||disabled||!state.draftComplete||state.committedGameId||state.bpInputMode!=='screen'||submission?.phase==='submitting'||submission?.phase==='rejected'||submission?.phase==='unconfirmed')return;
    const timer=setInterval(()=>void scan(),1600);void scan();return()=>clearInterval(timer);
  },[auto,videoReady,disabled,state.draftComplete,state.committedGameId,state.bpInputMode,submission?.phase,scan]);

  const applyCandidate=(side?:Side)=>{
    pauseAuto();
    const current=candidateRef.current,target=current&&reviewedLineupTarget(current,latest.current.state,side);
    if(!target){setBlocked(zh?'候选已过期或低于可信门槛，请重新识别；可直接人工交换英雄。':'Candidate expired or below the trust thresholds. Scan again, or swap heroes manually.');return;}
    submitTarget(target,false,undefined,true);
  };
  const change=(side:Side,index:number,heroId:number)=>{
    const current=latest.current.state,blue=[...current.blueAssignments],red=[...current.redAssignments],order=side==='blue'?blue:red,other=order.indexOf(heroId);
    if(other<0||order[index]===heroId)return;
    [order[index],order[other]]=[order[other],order[index]];
    pauseAuto();saveCandidate(undefined);
    if(validLineupOrder(blue,current.bluePicks)&&validLineupOrder(red,current.redPicks))submitTarget({blue,red});
    else setBlocked(zh?'当前另一队阵容不完整，请先确认完整的五人英雄。':'The other team has an incomplete saved lineup. Confirm all five heroes first.');
  };
  const target=candidate&&reviewedLineupTarget(candidate,state),blueOnly=candidate&&reviewedLineupTarget(candidate,state,'blue'),redOnly=candidate&&reviewedLineupTarget(candidate,state,'red');
  const blueTrusted=trustedLineup(candidate?.blue),redTrusted=trustedLineup(candidate?.red);
  const candidateState=!candidate?(busy?'detecting':'idle'):!blueTrusted||!redTrusted?'review':candidate.stableCount>=2?'stable':'detected';
  const phase=blocked?'unconfirmed':submission?.phase??candidateState;
  const status=phase==='applied'?(zh?'已应用 · 服务器已确认':'Applied · server confirmed'):phase==='submitting'?(zh?'提交中 · 等待回执与已保存阵容':'Submitting · waiting for ACK and saved lineup'):phase==='rejected'?(zh?'已拒绝':'Rejected'):phase==='unconfirmed'?(zh?'待核对 · 请检查已保存阵容':'Unconfirmed · verify saved lineup'):phase==='expired'?(zh?'旧候选已失效':'Previous candidate expired'):phase==='stable'?(zh?'候选稳定 · 等待应用':'Stable candidate · awaiting application'):phase==='review'?(zh?'已识别 · 需要人工核对':'Detected · needs review'):phase==='detected'?(zh?'已识别 · 等待第二帧稳定':'Detected · waiting for a second stable frame'):phase==='detecting'?(zh?'识别中':'Detecting'):(zh?'等待识别或人工交换':'Waiting for recognition or manual swap');
  const isSubmitting=submission?.phase==='submitting';
  const retryAllowed=submission&&submission.identityContext===identity&&submission.expectedContext===writeContext&&(submission.origin!=='recognition'||[target,blueOnly,redOnly].some(value=>value&&JSON.stringify(value)===JSON.stringify(submission.target)));
  return <>
    <video ref={videoRef} className="lineup-capture-video" playsInline muted/>
    {state.draftComplete&&!state.committedGameId&&<section className="panel lineup-sync" data-lineup-state={phase}>
      <div className="lineup-sync-head"><div><h2>{zh?'最终阵容归属 / 换英雄检测':'Final lineup ownership / hero-swap detection'}</h2><p className="muted">{zh?'帮抢与交换只修改最终使用者；Pick/Ban 历史保持不变。发送后必须核对服务器回执与已保存阵容。':'Hero swaps change final ownership while Pick/Ban history remains unchanged. Success requires both the server ACK and matching saved assignments.'}</p></div>
        <button disabled={disabled||isSubmitting} onClick={()=>{pauseAuto();saveCandidate(undefined);submitTarget({blue:[...state.bluePicks],red:[...state.redPicks]});}}>{zh?'按选角顺序重置':'Reset to pick order'}</button></div>
      <p role="status" className="lineup-status"><strong>{status}</strong>{blocked||submission?.error?<span> · {blocked||submission?.error}</span>:null}</p>
      {submission&&<p className="muted">{zh?'本次提案':'Submitted proposal'} · {submission.target.blue.map(id=>label(state,id)).join(' / ')} | {submission.target.red.map(id=>label(state,id)).join(' / ')} · {zh?'提交版本':'Base revision'} {submission.baseRevision}{submission.acknowledgedRevision!==undefined?` → ACK ${submission.acknowledgedRevision}`:''}</p>}
      <div className="lineup-team-grid">{(['blue','red'] as const).map(side=>{
        const solved=candidate?.[side],trusted=trustedLineup(solved);
        return <section className={`lineup-team ${side}`} key={side} data-lineup-side={side} data-trusted={trusted}><h3>{state[`${side}Team`].name}</h3>
          {solved&&<p className="muted">{zh?'平均 / 最低':'Average / minimum'} {Math.round(solved.average*100)}% / {Math.round(solved.minimum*100)}% · {trusted?(zh?'达到门槛':'Thresholds met'):(zh?'未达到门槛，不自动写入':'Below thresholds; never auto-applied')}</p>}
          {state[`${side}Team`].players.map((_,index)=>{const player=playerAtSlot(state,side,index).id,detected=solved?{heroId:solved.heroes[index],confidence:solved.confidence[index]}:candidate?.results.find(row=>row.side===side&&row.playerIndex===index)?.candidates[0];return <div className="lineup-player-row" key={index}><span className="lineup-player-name">{player||`${zh?'选手':'Player'} ${index+1}`}</span><select aria-label={`${player||`Player ${index+1}`} hero`} disabled={disabled||isSubmitting} value={state[`${side}Assignments`][index]??''} onChange={e=>change(side,index,Number(e.target.value))}>{state[`${side}Picks`].map(id=><option key={id} value={id}>{label(state,id)}</option>)}</select><span className="lineup-detected">{detected?`${label(state,detected.heroId)} ${Math.round(detected.confidence*100)}%${!solved?(zh?' · 待核对':' · needs review'):''}`:'—'}</span></div>;})}
        </section>;
      })}</div>
      {state.bpInputMode==='screen'&&<div className="lineup-auto"><div className="lineup-auto-toolbar">
        <label><input type="checkbox" checked={auto} onChange={e=>{stopScan();setAuto(e.target.checked);latest.current.auto=e.target.checked;try{localStorage.setItem('hok-lineup-auto',e.target.checked?'1':'0');}catch{/* Session preference still applies. */}}}/>{zh?'自动检测并同步换英雄':'Automatically detect and sync hero swaps'}</label>
        {!videoReady&&<button disabled={disabled||connecting} onClick={()=>void connectWindow()}>{connecting?(zh?'正在连接…':'Connecting…'):(zh?'连接 BP 窗口':'Connect BP window')}</button>}
        <button disabled={disabled||busy||!videoReady||isSubmitting} onClick={()=>{pauseAuto();void scan(true);}}>{busy?(zh?'正在识别…':'Recognizing…'):(zh?'立即识别并应用换英雄':'Recognize and apply swap now')}</button>
        {candidate&&target&&<button disabled={disabled||isSubmitting||lineupTargetMatches(target,state)} onClick={()=>applyCandidate()}>{zh?'应用本次识别':'Apply this scan'}</button>}
        {blueTrusted&&!redTrusted&&blueOnly&&<button disabled={disabled||isSubmitting||lineupTargetMatches(blueOnly,state)} onClick={()=>applyCandidate('blue')}>{zh?'核对后仅应用可信蓝方':'Apply verified blue team'}</button>}
        {redTrusted&&!blueTrusted&&redOnly&&<button disabled={disabled||isSubmitting||lineupTargetMatches(redOnly,state)} onClick={()=>applyCandidate('red')}>{zh?'核对后仅应用可信红方':'Apply verified red team'}</button>}
        {candidate&&<button disabled={isSubmitting} onClick={()=>{pauseAuto();saveCandidate(undefined);setBlocked('');setMessage(zh?'候选已取消；服务器已保存阵容保持不变。':'Candidate cancelled; saved assignments remain unchanged.');}}>{zh?'取消候选':'Cancel candidate'}</button>}
      </div><p className="muted">{message||(videoReady?(zh?`复用 BP 窗口：${streamLabel}。`:`Reusing BP window: ${streamLabel}.`):(zh?'等待共享 BP 窗口，也可直接人工交换英雄。':'Waiting for the shared BP window; manual swaps remain available.'))}{candidate?` · ${zh?'同一候选连续帧':'Matching frames'} ${candidate.stableCount}/2`:''}</p>
      {candidate&&(!blueTrusted||!redTrusted)&&<p className="muted">{zh?'仅一队可信时，可人工核对后应用该队；另一队保留现有合法阵容。低置信度英雄不会被发送。':'When only one team is trusted, review and apply that team while retaining the other team’s legal saved assignments. Weak OCR heroes are never sent.'}</p>}</div>}
      {submission&&(submission.phase==='rejected'||submission.phase==='unconfirmed')&&<button disabled={disabled||!retryAllowed} onClick={()=>{pauseAuto();submitTarget(submission.target,false,undefined,submission.origin==='recognition');}}>{zh?'人工重试已核对阵容':'Retry reviewed lineup'}</button>}
      {isSubmitting&&<button onClick={()=>{pauseAuto();setSubmission(old=>old?{...old,phase:'unconfirmed',error:'Stopped waiting locally; this does not cancel a command already received by the server'}:old);}}>{zh?'停止等待并核对':'Stop waiting and verify'}</button>}
      {blocked&&candidate&&target&&<button disabled={disabled||isSubmitting} onClick={()=>applyCandidate()}>{zh?'人工重试已核对阵容':'Retry reviewed lineup'}</button>}
    </section>}
  </>;
}
