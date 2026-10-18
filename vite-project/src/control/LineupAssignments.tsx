import { playerAtSlot } from '../shared/playerSlots';
import { apiURL } from '../shared/config';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const SLOTS_STORAGE='hok-window-capture-slots-v3';

function readCaptureSlots():CaptureSlots {
  try {
    const stored=JSON.parse(localStorage.getItem(SLOTS_STORAGE)||'null');
    if(stored&&typeof stored==='object') return normalizeCaptureSlots(stored);
  } catch { /* use defaults */ }
  return normalizeCaptureSlots(defaultCaptureSlots);
}

function sameLineup(a:Array<number|null>,b:number[]) {
  return a.length===b.length&&a.every((value,index)=>value===b[index]);
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

export function LineupAssignments({
  state,revision,token,disabled,send,
}:{
  state:MatchState;
  revision:number;
  token:string;
  disabled:boolean;
  send:(action:Action)=>void;
}) {
  const zh=state.language==='zh';
  const [auto,setAuto]=useState(()=>{try{return localStorage.getItem('hok-lineup-auto')!=='0';}catch{return true;}});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [results,setResults]=useState<SlotResult[]>([]);
  const [videoReady,setVideoReady]=useState(false);
  const [streamLabel,setStreamLabel]=useState('');
  const [connecting,setConnecting]=useState(false);
  const [slots,setSlots]=useState(readCaptureSlots);
  const videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream>();
  const mounted=useRef(true);
  const applying=useRef<{signature:string;at:number}>({signature:'',at:0});
  const stableRef=useRef({signature:'',count:0});
  const busyRef=useRef(false);
  const activeScan=useRef<AbortController>();
  const captureRequest=useRef<AbortController>();
  const context=JSON.stringify([state.draftGameNumber??state.gameNumber,state.blueTeam.id,state.redTeam.id,state.blueTeam.players,state.redTeam.players,state.bluePicks,state.redPicks,state.blueAssignments,state.redAssignments,state.bluePlayerSlotOrder,state.redPlayerSlotOrder,state.draftComplete,state.committedGameId,state.bpInputMode,disabled,token,auto,slots]);
  const contextRef=useRef(context);
  contextRef.current=context;

  const blueResults=results.filter(slot=>slot.side==='blue').sort((a,b)=>a.playerIndex-b.playerIndex);
  const redResults=results.filter(slot=>slot.side==='red').sort((a,b)=>a.playerIndex-b.playerIndex);
  const blueSolved=useMemo(()=>solveTeam(blueResults,state.bluePicks),[blueResults,state.bluePicks]);
  const redSolved=useMemo(()=>solveTeam(redResults,state.redPicks),[redResults,state.redPicks]);

  const attachStream=useCallback(async(stream:MediaStream|undefined)=>{
    if(streamRef.current!==stream){
      activeScan.current?.abort();
      stableRef.current={signature:'',count:0};
      setResults([]);
    }
    streamRef.current=stream;
    const video=videoRef.current;
    if(!stream||!video){
      if(video) video.srcObject=null;
      setVideoReady(false);
      setStreamLabel('');
      return;
    }
    video.srcObject=stream;
    video.muted=true;
    setVideoReady(false);
    try {
      await video.play();
      if(!mounted.current||streamRef.current!==stream||video.srcObject!==stream)return;
      const track=stream.getVideoTracks()[0];
      setStreamLabel(track?.label||'BP window');
      setVideoReady(!!video.videoWidth&&!!video.videoHeight);
      if(video.readyState<1) {
        video.addEventListener('loadedmetadata',()=>{
          if(mounted.current&&streamRef.current===stream&&video.srcObject===stream) setVideoReady(!!video.videoWidth&&!!video.videoHeight);
        },{once:true});
      }
    } catch {
      if(mounted.current&&streamRef.current===stream) setVideoReady(false);
    }
  },[]);

  useEffect(()=>{
    mounted.current=true;
    const element=videoRef.current;
    void attachStream(getSharedWindowCaptureStream());
    const unsubscribe=subscribeSharedWindowCapture(stream=>{void attachStream(stream);});
    const refresh=()=>{activeScan.current?.abort();stableRef.current={signature:'',count:0};setSlots(readCaptureSlots());setResults([]);};
    const video=videoRef.current;
    const resize=()=>{
      activeScan.current?.abort();stableRef.current={signature:'',count:0};setResults([]);
      setVideoReady(!!video?.videoWidth&&!!video.videoHeight&&!!streamRef.current?.getVideoTracks().some(track=>track.readyState==='live'));
    };
    video?.addEventListener('resize',resize);
    window.addEventListener('hok-capture-slots-changed',refresh);
    return()=>{
      mounted.current=false;
      unsubscribe();video?.removeEventListener('resize',resize);window.removeEventListener('hok-capture-slots-changed',refresh);
      captureRequest.current?.abort();
      activeScan.current?.abort();
      if(element)element.srcObject=null;
    };
  },[attachStream]);

  useEffect(()=>{
    activeScan.current?.abort();
    stableRef.current={signature:'',count:0};
    applying.current={signature:'',at:0};
    setResults([]);
    setMessage('');
  },[context]);

  const connectWindow=useCallback(async()=>{
    if(captureRequest.current||disabled)return;
    if(!navigator.mediaDevices?.getDisplayMedia) {
      setMessage(zh?'当前浏览器不支持窗口采集。':'Window capture is not supported by this browser.');
      return;
    }
    const controller=new AbortController();
    captureRequest.current=controller;
    setConnecting(true);
    try {
      await connectSharedBpWindow(false,controller.signal);
    } catch {
      if(mounted.current&&!controller.signal.aborted)setMessage(zh?'未连接 BP 窗口，换英雄仍可手动修改。':'BP window was not connected; hero swaps can still be adjusted manually.');
    } finally {
      if(captureRequest.current===controller)captureRequest.current=undefined;
      if(mounted.current)setConnecting(false);
    }
  },[disabled,zh]);

  const applyLineups=useCallback((blue:number[],red:number[])=>{
    if(disabled||!state.draftComplete||state.committedGameId) return;
    activeScan.current?.abort();stableRef.current={signature:'',count:0};setResults([]);
    send({type:'set_lineup_assignments',blue,red});
  },[disabled,state.draftComplete,state.committedGameId,send]);

  const recognizeSlot=useCallback(async(side:Side,index:number,frame:HTMLCanvasElement,signal:AbortSignal)=>{
    signal.throwIfAborted();
    const key=pickKey(side,index);
    const image=captureFrame(frame,slots[key]);
    const response=await fetch(`${apiURL}/api/recognize-frame`,{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        image,
        revision,
        allowedHeroIds:state[`${side}Picks`],
        shape:'square',
      }),
      signal,
    });
    const data=await response.json();
    if(!response.ok) throw new Error(zh?'换英雄识别失败。':'Hero-swap recognition failed.');
    return {
      side,
      playerIndex:index,
      preview:data.preview as string,
      candidates:(data.candidates??[]) as Candidate[],
    } satisfies SlotResult;
  },[revision,slots,state,token,zh]);

  const scan=useCallback(async(forceApply=false)=>{
    if(busyRef.current||disabled||!state.draftComplete||state.committedGameId||state.bpInputMode!=='screen'||!videoReady) return;
    busyRef.current=true;
    setBusy(true);
    const capturedContext=contextRef.current;
    const capturedStream=streamRef.current;
    const controller=new AbortController();
    activeScan.current=controller;
    const timeout=setTimeout(()=>controller.abort(),25000);
    try {
      const video=videoRef.current;
      if(!video?.videoWidth||!streamRef.current?.getVideoTracks().some(track=>track.readyState==='live'))throw new Error('BP window is not connected.');
      const frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d')!.drawImage(video,0,0);
      const work=(['blue','red'] as const).flatMap(side=>
        Array.from({length:5},(_,index)=>({side,index})));
      // Final-lineup swaps are not frame-critical. Keep only two recognition
      // requests in flight to avoid CPU spikes while OBS is encoding.
      const scanned=await mapWithConcurrency(work,2,item=>recognizeSlot(item.side,item.index,frame,controller.signal));
      if(!mounted.current||controller.signal.aborted||capturedContext!==contextRef.current||capturedStream!==streamRef.current)return;
      setResults(scanned);

      const blue=solveTeam(scanned.filter(slot=>slot.side==='blue').sort((a,b)=>a.playerIndex-b.playerIndex),state.bluePicks);
      const red=solveTeam(scanned.filter(slot=>slot.side==='red').sort((a,b)=>a.playerIndex-b.playerIndex),state.redPicks);
      if(!blue||!red){
        stableRef.current={signature:'',count:0};
        setMessage(zh?'暂时无法唯一确认 10 个英雄，继续监视。':'Could not uniquely resolve all ten heroes yet; continuing to watch.');
        return;
      }

      const signature=`${blue.heroes.join(',')}|${red.heroes.join(',')}`;
      const previous=stableRef.current;
      const count=previous.signature===signature?previous.count+1:1;
      stableRef.current={signature,count};
      const changed=!sameLineup(state.blueAssignments,blue.heroes)||!sameLineup(state.redAssignments,red.heroes);
      const highConfidence=blue.minimum>=.50&&red.minimum>=.50&&blue.average>=.65&&red.average>=.65;

      setMessage(zh
        ? `换英雄检测运行中 · 蓝均值/最低 ${Math.round(blue.average*100)}%/${Math.round(blue.minimum*100)}% · 红均值/最低 ${Math.round(red.average*100)}%/${Math.round(red.minimum*100)}% · 稳定 ${count}/2${changed?' · 检测到阵容变化':''}${changed&&!highConfidence?' · 但置信度不足，暂不自动应用':''}`
        : `Hero-swap detection active · blue avg/min ${Math.round(blue.average*100)}%/${Math.round(blue.minimum*100)}% · red avg/min ${Math.round(red.average*100)}%/${Math.round(red.minimum*100)}% · stable ${count}/2${changed?' · lineup change detected':''}${changed&&!highConfidence?' · confidence too low to auto-apply':''}`);

      const shouldApply=changed&&highConfidence&&(forceApply||(auto&&count>=2));
      const now=Date.now();
      const recentlyTried=applying.current.signature===signature&&now-applying.current.at<2500;
      if(shouldApply&&!recentlyTried){
        applying.current={signature,at:now};
        applyLineups(blue.heroes,red.heroes);
        setMessage(zh
          ? `已检测到换英雄并发送自动同步 · 蓝 ${Math.round(blue.average*100)}% · 红 ${Math.round(red.average*100)}%`
          : `Hero swap detected; automatic lineup sync sent · blue ${Math.round(blue.average*100)}% · red ${Math.round(red.average*100)}%`);
      }
    } catch(error) {
      if(mounted.current&&capturedContext===contextRef.current&&capturedStream===streamRef.current) setMessage(controller.signal.aborted
        ? (zh?'识别超时，请检查连接后重试。':'Recognition timed out. Check the connection and retry.')
        : error instanceof Error?error.message:'Capture failed');
    } finally {
      clearTimeout(timeout);
      controller.abort();
      if(activeScan.current===controller)activeScan.current=undefined;
      busyRef.current=false;
      if(mounted.current) setBusy(false);
    }
  },[applyLineups,auto,disabled,recognizeSlot,state,videoReady,zh]);

  useEffect(()=>{
    const currentSignature=`${state.blueAssignments.join(',')}|${state.redAssignments.join(',')}`;
    if(applying.current.signature===currentSignature) applying.current={signature:'',at:0};
  },[state.blueAssignments,state.redAssignments]);

  useEffect(()=>{
    if(!auto||!videoReady||state.bpInputMode!=='screen'||!state.draftComplete||state.committedGameId||disabled) return;
    const timer=setInterval(()=>{void scan();},1600);
    void scan();
    return()=>clearInterval(timer);
  },[auto,disabled,scan,state.bpInputMode,state.committedGameId,state.draftComplete,videoReady]);

  const draftReady=state.draftComplete&&!state.committedGameId;

  const current=(side:Side)=>state[`${side}Assignments`] as Array<number|null>;
  const picked=(side:Side)=>state[`${side}Picks`];
  const pauseAuto=()=>{
    activeScan.current?.abort();
    setAuto(false);
    try{localStorage.setItem('hok-lineup-auto','0');}catch{/* Session setting still applies. */}
    setMessage(zh?'已暂停自动同步，保留手动阵容。需要时可重新开启。':'Automatic sync paused to preserve the manual lineup. You can enable it again.');
  };
  const change=(side:Side,index:number,heroId:number)=>{
    const blue=[...state.blueAssignments] as Array<number|null>;
    const red=[...state.redAssignments] as Array<number|null>;
    const assignments=side==='blue'?blue:red;
    const other=assignments.indexOf(heroId);
    if(other<0||assignments[index]===heroId) return;
    [assignments[index],assignments[other]]=[assignments[other],assignments[index]];
    if(blue.some(value=>value===null)||red.some(value=>value===null)) return;
    pauseAuto();
    applyLineups(blue as number[],red as number[]);
  };
  const resultFor=(side:Side,index:number)=>results.find(result=>result.side===side&&result.playerIndex===index);

  return <>
    <video ref={videoRef} className="lineup-capture-video" playsInline muted />
    {draftReady&&<section className="panel lineup-sync">
      <div className="lineup-sync-head">
        <div>
          <h2>{zh?'最终阵容归属 / 换英雄检测':'Final lineup ownership / hero-swap detection'}</h2>
          <p className="muted">{zh?'Pick/Ban 历史保持不变；这里根据最终 10 个玩家槽位持续检测英雄互换。':'Pick/Ban history stays immutable; this continuously watches the ten final player slots for hero swaps.'}</p>
        </div>
        <button disabled={disabled} onClick={()=>{pauseAuto();applyLineups([...state.bluePicks],[...state.redPicks]);}}>{zh?'按选角顺序重置':'Reset to pick order'}</button>
      </div>

      <div className="lineup-team-grid">
        {(['blue','red'] as const).map(side=><section className={`lineup-team ${side}`} key={side}>
          <h3>{state[`${side}Team`].name}</h3>
          {state[`${side}Team`].players.map((_,index)=>{
            const player = playerAtSlot(state, side, index).id;
            const detected=resultFor(side,index);
            const top=detected?.candidates[0];
            return <div className="lineup-player-row" key={index}>
              <span className="lineup-player-name">{player||`${zh?'选手':'Player'} ${index+1}`}</span>
              <select aria-label={`${player||`Player ${index+1}`} hero`} disabled={disabled} value={current(side)[index]??''} onChange={event=>change(side,index,Number(event.target.value))}>
                {picked(side).map(heroId=><option key={heroId} value={heroId}>{label(state,heroId)}</option>)}
              </select>
              <span className="lineup-detected">{top?`${label(state,top.heroId)} ${Math.round(top.confidence*100)}%`:'—'}</span>
            </div>;
          })}
        </section>)}
      </div>

      {state.bpInputMode==='screen'&&<div className="lineup-auto">
        <div className="lineup-auto-toolbar">
          <label><input type="checkbox" checked={auto} onChange={event=>{
            activeScan.current?.abort();
            setAuto(event.target.checked);
            try{localStorage.setItem('hok-lineup-auto',event.target.checked?'1':'0');}catch{/* Session setting still applies. */}
          }} /> {zh?'自动检测并同步换英雄':'Automatically detect and sync hero swaps'}</label>
          {!videoReady&&<button disabled={disabled||connecting} onClick={()=>void connectWindow()}>{connecting?(zh?'正在连接…':'Connecting…'):(zh?'连接 BP 窗口':'Connect BP window')}</button>}
          <button disabled={disabled||busy||!videoReady} onClick={()=>void scan(true)}>{busy?(zh?'正在识别…':'Recognizing…'):(zh?'立即识别并应用换英雄':'Recognize and apply swap now')}</button>
          {blueSolved&&redSolved&&<button disabled={disabled||busy} onClick={()=>{pauseAuto();applyLineups(blueSolved.heroes,redSolved.heroes);}}>{zh?'应用本次识别':'Apply this scan'}</button>}
        </div>
        <p role="status" className="lineup-status">
          {message||(videoReady
            ? (zh?`已复用 BP 屏幕采集：${streamLabel||'窗口'}。阵容变化连续稳定 2 次后自动更新。`:`Reusing BP capture: ${streamLabel||'window'}. A changed lineup auto-applies after 2 stable scans.`)
            : (zh?'尚未连接 BP 窗口。若上方 Auto BP 已连接，会自动复用同一采集流；否则可在这里连接。':'No BP window connected. The existing Auto BP stream is reused automatically, or connect one here.'))}
        </p>
      </div>}
    </section>}
  </>;
}
