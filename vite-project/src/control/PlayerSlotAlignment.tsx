import {playerIdCropSize} from './playerIdCropSize.js';
import {mergeVerification} from '../shared/playerSlotVerification.js';
import type {VerificationEvidence} from '../shared/playerSlotVerification.js';
import { useEffect, useRef, useState } from 'react';
import type { Action, MatchState, Side } from '../shared/types';
import { playerAtSlot, type PlayerSlotSolution } from '../shared/playerSlots';
import { defaultCaptureSlots, normalizeCaptureSlots, type CaptureSlots, type CaptureSlotKey } from './bpCaptureLayout';
import { normalizeCaptureRegion, regionToPixels, type NormalizedCaptureRegion } from './windowCaptureGeometry';
import { getSharedWindowCaptureStream, subscribeSharedWindowCapture } from './sharedWindowCapture';
import { CaptureRegionPicker } from './CaptureRegionPicker';
import {
  PLAYER_ID_REGION_KEYS,
  PLAYER_ID_REGION_PRESETS_STORAGE,
  createPlayerIdRegionPreset,
  readPlayerIdRegionPresets,
  updatePlayerIdRegionPreset,
  type PlayerIdRegionPreset,
  type PlayerIdRegions,
} from './playerIdRegionPresets';

const storage='hok-window-capture-slots-v3';
const playerIdRegionVersion='hok-player-id-region-layout-v2';

function readSlots(): CaptureSlots {
  try{
    const parsed=JSON.parse(localStorage.getItem(storage)||'null')??defaultCaptureSlots;
    // Reset only the first experimental ID rectangles once. Keep all 18 BP
    // hero boxes and every later v2 calibration.
    if(localStorage.getItem(playerIdRegionVersion)!=='2'){
      if(parsed&&typeof parsed==='object'&&'playerIds' in parsed) delete parsed.playerIds;
      localStorage.setItem(storage,JSON.stringify(parsed));
      localStorage.setItem(playerIdRegionVersion,'2');
    }
    return normalizeCaptureSlots(parsed);
  }catch{return normalizeCaptureSlots(defaultCaptureSlots);}
}

function defaultIdRegion(slots: CaptureSlots, side: Side, index: number): NormalizedCaptureRegion {
  const pick=slots[(side+'Pick'+(index+1)) as CaptureSlotKey];
  const gap=.004;
  const desiredWidth=.16;
  const height=Math.max(.032,Math.min(.065,pick.height*.52));
  const y=pick.y+Math.max(0,(pick.height-height)/2);
  const x=side==='blue'?pick.x+pick.width+gap:pick.x-desiredWidth-gap;
  return normalizeCaptureRegion({
    x:Math.max(0,Math.min(1-desiredWidth,x)),
    y:Math.max(0,Math.min(1-height,y)),
    width:desiredWidth,
    height,
  });
}

function fallbackIdRegion(slots:CaptureSlots,side:Side,index:number):NormalizedCaptureRegion {
  const pick=slots[(side+'Pick'+(index+1)) as CaptureSlotKey];
  const width=.23;
  const height=Math.max(.055,Math.min(.12,pick.height*1.15));
  const y=pick.y-(height-pick.height)/2;
  const x=side==='blue'
    ? pick.x+pick.width*.55
    : pick.x-width+pick.width*.45;
  return normalizeCaptureRegion({
    x:Math.max(0,Math.min(1-width,x)),
    y:Math.max(0,Math.min(1-height,y)),
    width,
    height,
  });
}
function idRegion(slots: CaptureSlots, side: Side, index: number): NormalizedCaptureRegion {
  const key=`${side}${index+1}`;
  return slots.playerIds?.[key]??defaultIdRegion(slots,side,index);
}

interface Scan {
  context:string;
  texts:string[];
  blue?:PlayerSlotSolution;
  red?:PlayerSlotSolution;
  elapsedMs:number;
}

const sameOrder=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);

export function PlayerSlotAlignment({state,token,disabled,send}:{state:MatchState;token:string;disabled:boolean;send:(action:Action)=>void}) {
  const zh=state.language==='zh';
  const [ready,setReady]=useState(false);
  const [status,setStatus]=useState('');
  const [scan,setScan]=useState<Scan>();
  const [busy,setBusy]=useState(false);
  const [auto,setAuto]=useState(()=>{try{return localStorage.getItem('hok-player-slot-auto')!=='0';}catch{return true;}});
  const [manualScan,setManualScan]=useState(0);
  const [manualEdit,setManualEdit]=useState<Record<Side,boolean>>({blue:false,red:false});
  const [slots,setSlots]=useState(readSlots);
  const [selected,setSelected]=useState('blue1');
  const [preview,setPreview]=useState('');
  const [calibrationSnapshot,setCalibrationSnapshot]=useState('');
  const [calibrationOpen,setCalibrationOpen]=useState(false);
  const [idRegionPresets,setIdRegionPresets]=useState<PlayerIdRegionPreset[]>(
    ()=>{try{return readPlayerIdRegionPresets(localStorage.getItem(PLAYER_ID_REGION_PRESETS_STORAGE));}catch{return [];}},
  );
  const [selectedIdRegionPresetId,setSelectedIdRegionPresetId]=useState('');
  const [idRegionPresetName,setIdRegionPresetName]=useState('');

  const video=useRef<HTMLVideoElement>(null);
  const latest=useRef({state,disabled,send,scanContext:scan?.context,scan});
  const inFlight=useRef(false);
  const activeRequest=useRef<AbortController>();
  const generation=useRef(0);
  const accepted=useRef<Partial<Record<Side,string>>>({});
  const verification=useRef<Partial<Record<Side,VerificationEvidence>>>({});
  const submittedScan=useRef<{scan:Scan;orders:Partial<Record<Side,number[]>>}>();
  const lastSample=useRef<{schemaVersion:1;capturedAt:string;attempts:{images:string[];players:string[][];result:unknown}[]}>();
  latest.current={state,disabled,send,scanContext:scan?.context,scan};

  const context=JSON.stringify([state.blueTeam.id,state.redTeam.id,state.blueTeam.players,state.redTeam.players,state.gameNumber,state.bpInputMode,state.committedGameId]);
  const contextRef=useRef(context);
  contextRef.current=context;

  useEffect(()=>{
    submittedScan.current=undefined;
    accepted.current={};
    verification.current={};
    setScan(undefined);
    lastSample.current=undefined;
    setStatus('');
    setManualEdit({blue:false,red:false});
    generation.current++;
  },[context,state.committedGameId]);

  useEffect(()=>{
    if(!disabled)return;
    generation.current++;
    activeRequest.current?.abort();
    verification.current={};
    setScan(undefined);
  },[disabled]);

  useEffect(()=>{
    if(disabled||!submittedScan.current)return;
    const submitted=submittedScan.current;
    submittedScan.current=undefined;
    if(submitted.scan.context!==context)return;
    const sides=Object.keys(submitted.orders) as Side[];
    if(!sides.every(side=>sameOrder(state[`${side}PlayerSlotOrder`],submitted.orders[side]!)))return;
    for(const side of sides)accepted.current[side]=submitted.orders[side]!.join(',');
    // Only a proposal confirmed by authoritative state may regain its synced
    // display after a pending write. Unconfirmed or failed scans stay invalid.
    setScan(submitted.scan);
  },[context,disabled,state]);

  useEffect(()=>{
    const refresh=()=>{generation.current++;activeRequest.current?.abort();accepted.current={};verification.current={};setScan(undefined);lastSample.current=undefined;setSlots(readSlots());};
    window.addEventListener('hok-capture-slots-changed',refresh);
    return()=>window.removeEventListener('hok-capture-slots-changed',refresh);
  },[]);

  useEffect(()=>{
    let active=true;
    const element=video.current;
    const attach=async(stream:MediaStream|undefined)=>{
      setCalibrationSnapshot('');setPreview('');
      if(!video.current)return;
      const element=video.current;
      generation.current++;
      activeRequest.current?.abort();
      submittedScan.current=undefined;
      accepted.current={};
      verification.current={};
      setScan(undefined);
      element.srcObject=stream??null;
      setReady(false);
      if(stream)try{await element.play();if(active&&element.srcObject===stream)setReady(!!element.videoWidth&&!!element.videoHeight);}catch{/* capture not ready */}
    };
    void attach(getSharedWindowCaptureStream());
    const unsubscribe=subscribeSharedWindowCapture(stream=>void attach(stream));
    const resize=()=>{
      generation.current++;activeRequest.current?.abort();accepted.current={};verification.current={};setScan(undefined);lastSample.current=undefined;setCalibrationSnapshot('');setPreview('');
      setReady(!!element?.videoWidth&&!!element.videoHeight&&element.srcObject instanceof MediaStream&&element.srcObject.getVideoTracks().some(track=>track.readyState==='live'));
    };
    element?.addEventListener('resize',resize);
    const sourceGeneration=generation;
    return()=>{active=false;sourceGeneration.current++;unsubscribe();element?.removeEventListener('resize',resize);activeRequest.current?.abort();if(element)element.srcObject=null;};
  },[]);

  function apply(side:Side,solution:PlayerSlotSolution) {
    const current=latest.current;
    if(current.disabled||current.state.committedGameId||current.scanContext!==contextRef.current)return;
    if(current.scan)submittedScan.current={scan:current.scan,orders:{[side]:[...solution.order]}};
    current.send({
      type:'set_player_slot_order',
      side,
      order:solution.order,
      expectedPlayers:[...current.state[`${side}Team`].players],
    });
  }

  function saveRecognitionSample(){
    if(!lastSample.current)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(lastSample.current,null,2)],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;link.download='hok-player-id-sample.json';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function requestRescan() {
    activeRequest.current?.abort();
    submittedScan.current=undefined;
    accepted.current={};
    verification.current={};
    setScan(undefined);
    setStatus(zh?'准备重新识别…':'Preparing rescan…');
    generation.current++;
    setManualScan(value=>value+1);
  }

  function restoreAutoRecognition() {
    activeRequest.current?.abort();
    submittedScan.current=undefined;
    accepted.current={};
    verification.current={};
    setManualEdit({blue:false,red:false});
    setScan(undefined);
    setAuto(true);
    try{localStorage.setItem('hok-player-slot-auto','1');}catch{/* Session preference still applies. */}
    setStatus(zh?'已恢复自动识别，正在重新扫描…':'Automatic recognition restored; rescanning…');
    generation.current++;
    setManualScan(value=>value+1);
  }

  function pauseRecognition() {
    generation.current++;
    activeRequest.current?.abort();
    verification.current={};
    setAuto(false);
    setManualScan(0);
    setBusy(false);
    try{localStorage.setItem('hok-player-slot-auto','0');}catch{/* Session preference still applies. */}
  }

  useEffect(()=>{
    if(disabled||!ready||state.bpInputMode!=='screen'||state.committedGameId||(!auto&&manualScan===0))return;
    let active=true;
    let providerReady=false;
    let retryAt=0;
    const api=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
    const headers={Authorization:`Bearer ${token}`};

    async function run() {
      const current=latest.current;
      if(inFlight.current||Date.now()<retryAt||(auto&&(['blue','red'] as const).every(side=>
        accepted.current[side]===current.state[`${side}PlayerSlotOrder`].join(',')
      )))return;
      inFlight.current=true;
      const controller=new AbortController();
      activeRequest.current=controller;
      const timeout=setTimeout(()=>controller.abort(),20000);
      const epoch=generation.current;
      try{
        if(!ready||current.disabled||current.state.committedGameId||!video.current?.videoWidth||!(video.current.srcObject instanceof MediaStream)||!video.current.srcObject.getVideoTracks().some(track=>track.readyState==='live'))return;
        setBusy(true);
        if(!providerReady){
          const health=await fetch(`${api}/api/v1/recognition/players`,{headers,signal:controller.signal}).then(r=>r.json());
          if(!active)return;
          if(health.status!=='ready'){
            retryAt=Date.now()+3000;
            setStatus(zh?`选手 OCR 未就绪：${health.error||health.status}`:`Player OCR not ready: ${health.error||health.status}`);
            return;
          }
          providerReady=true;
        }

        const source=video.current;
        const frame=document.createElement('canvas');
        frame.width=source.videoWidth;
        frame.height=source.videoHeight;
        frame.getContext('2d')!.drawImage(source,0,0);

        const regions=readSlots();
        const capturedContext=contextRef.current;
        const captureImages=(wide=false)=>(['blue','red'] as const).flatMap(side=>Array.from({length:5},(_,index)=>{
          const cropRegion=wide?fallbackIdRegion(regions,side,index):idRegion(regions,side,index);
          const pixels=regionToPixels(cropRegion,frame.width,frame.height);
          const crop=document.createElement('canvas');
          const size=playerIdCropSize(pixels.width,pixels.height);
          crop.width=size.width;
          crop.height=size.height;
          crop.getContext('2d')!.drawImage(frame,pixels.x,pixels.y,pixels.width,pixels.height,0,0,crop.width,crop.height);
          return crop.toDataURL('image/png');
        }));
        const attempts:{images:string[];players:string[][];result:unknown}[]=[];
        const recognize=async(images:string[])=>{
          const response=await fetch(`${api}/api/v1/recognition/players`,{
            method:'POST',
            headers:{...headers,'Content-Type':'application/json'},
            body:JSON.stringify({
              images,
              players:[current.state.blueTeam.players,current.state.redTeam.players],
              gameNumber:current.state.gameNumber,
            }),
            signal:controller.signal,
          });
          const value=await response.json();
          if(!response.ok)throw new Error(value.error);
          attempts.push({images,players:[[...current.state.blueTeam.players],[...current.state.redTeam.players]],result:value});
          return value;
        };

        setStatus(zh?'选手顺序识别中…':'Recognizing player order…');
        let result=await recognize(captureImages(false));
        const readable=(result.confidences??[]).filter((value:number)=>value>=.15).length;
        const anyText=(result.texts??[]).some((value:string)=>value.trim());
        let usedFallback=false;
        if(readable===0||!anyText){
          const fallback=await recognize(captureImages(true));
          const score=(value:{confidences?:number[]})=>(value.confidences??[]).reduce((sum:number,item:number)=>sum+item,0);
          if(score(fallback)>score(result)){result=fallback;usedFallback=true;}
        }

        if(!active||epoch!==generation.current||capturedContext!==contextRef.current)return;
        lastSample.current={schemaVersion:1,capturedAt:new Date().toISOString(),attempts};
        const blueMerged=mergeVerification(verification.current.blue,result.blue);
        const redMerged=mergeVerification(verification.current.red,result.red);
        verification.current.blue=blueMerged.evidence;
        verification.current.red=redMerged.evidence;
        const verifiedFrames=Math.max(
          blueMerged.solution?.verificationFrames??0,
          redMerged.solution?.verificationFrames??0,
        );
        setScan({
          ...result,
          context:capturedContext,
          blue:blueMerged.solution,
          red:redMerged.solution,
        });
        setStatus(zh
          ? `本地 OCR ${Math.round(result.elapsedMs)} ms${usedFallback?' · 已自动扩大 ID 区域':''}${verifiedFrames>=2?' · 多帧复核通过':''}`
          : `Local OCR ${Math.round(result.elapsedMs)} ms${usedFallback?' · automatic wide-ID fallback':''}${verifiedFrames>=2?' · temporal verification passed':''}`);
        if(!auto)setManualScan(0);
      }catch(error){
        // A source resize or calibration change cancels the old epoch. Retry
        // the current frame on the next tick instead of treating it as a
        // network failure and imposing the two-second error backoff.
        if(!active||epoch!==generation.current)return;
        retryAt=Date.now()+2000;
        if(active)setStatus(controller.signal.aborted
          ? (zh?'选手识别超时，请检查连接后重试。':'Player recognition timed out. Check the connection and retry.')
          : error instanceof Error?error.message:'OCR failed');
        if(active&&!auto)setManualScan(0);
      }finally{
        clearTimeout(timeout);
        if(activeRequest.current===controller){
          activeRequest.current=undefined;
          inFlight.current=false;
          if(active)setBusy(false);
        }
      }
    }

    const cleanup=()=>{
      active=false;
      generation.current++;
      activeRequest.current?.abort();
      activeRequest.current=undefined;
      inFlight.current=false;
      setBusy(false);
    };

    if(auto){
      const timer=setInterval(()=>void run(),100);
      void run();
      return()=>{cleanup();clearInterval(timer);};
    }
    void run();
    return cleanup;
  },[auto,context,disabled,manualScan,ready,state.bpInputMode,state.committedGameId,token,zh,slots]);

  useEffect(()=>{
    if(!auto||disabled||!scan||scan.context!==contextRef.current||state.committedGameId)return;
    // The channel permits one pending action. Apply a trusted ten-slot frame
    // atomically instead of depending on a later render/OCR frame for red.
    if(scan.blue?.automatic&&scan.red?.automatic&&(
      !sameOrder(state.bluePlayerSlotOrder,scan.blue.order)||
      !sameOrder(state.redPlayerSlotOrder,scan.red.order)
    )){
      submittedScan.current={scan,orders:{blue:[...scan.blue.order],red:[...scan.red.order]}};
      latest.current.send({type:'set_player_slot_orders',blue:scan.blue.order,red:scan.red.order,
        expectedPlayers:[[...state.blueTeam.players],[...state.redTeam.players]]});
      return;
    }
    for(const side of ['blue','red'] as const){
      const solution=scan[side];
      if(!solution?.automatic)continue;
      const signature=solution.order.join(',');
      if(state[`${side}PlayerSlotOrder`].join(',')===signature){accepted.current[side]=signature;continue;}
      // An earlier accepted signature must not suppress restoration after a
      // manual or external order change. Authoritative state decides success.
      delete accepted.current[side];
      apply(side,solution);
      break;
    }
  },[auto,disabled,scan,state]);

  const selectedSide:Side=selected.startsWith('blue')?'blue':'red';
  const selectedIndex=Number(selected.slice(-1))-1;
  const region=idRegion(slots,selectedSide,selectedIndex);

  function saveSlots(next:CaptureSlots) {
    const normalized=normalizeCaptureSlots(next);
    try{localStorage.setItem(storage,JSON.stringify(normalized));}catch{
      setStatus(zh?'无法保存校准，请检查浏览器存储空间或隐私设置后重试。':'Calibration could not be saved. Check browser storage or privacy settings and retry.');
      return false;
    }
    setSlots(normalized);
    window.dispatchEvent(new Event('hok-capture-slots-changed'));
    accepted.current={};
    verification.current={};
    setScan(undefined);
    generation.current++;
    activeRequest.current?.abort();
    return true;
  }

  function updateSelectedRegion(nextRegion:NormalizedCaptureRegion) {
    const next=readSlots();
    next.playerIds={...(next.playerIds??{}),[selected]:normalizeCaptureRegion(nextRegion)};
    saveSlots(next);
  }

  function resetSelectedRegion() {
    const next=readSlots();
    if(next.playerIds){
      const playerIds={...next.playerIds};
      delete playerIds[selected];
      next.playerIds=playerIds;
    }
    saveSlots(next);
  }

  function resetAllIdRegions() {
    const next=readSlots();
    delete next.playerIds;
    saveSlots(next);
  }

  const selectedIdRegionPreset=idRegionPresets.find(item=>item.id===selectedIdRegionPresetId);

  function effectiveIdRegions(source:CaptureSlots=slots):PlayerIdRegions {
    const regions:PlayerIdRegions={};
    for(const key of PLAYER_ID_REGION_KEYS){
      const side:Side=key.startsWith('blue')?'blue':'red';
      const index=Number(key.slice(-1))-1;
      regions[key]=idRegion(source,side,index);
    }
    return regions;
  }

  function persistIdRegionPresets(next:PlayerIdRegionPreset[]) {
    const ordered=[...next].sort((a,b)=>b.updatedAt-a.updatedAt);
    try{localStorage.setItem(PLAYER_ID_REGION_PRESETS_STORAGE,JSON.stringify(ordered));}catch{
      setStatus(zh?'无法保存预设，请检查浏览器存储空间或隐私设置后重试。':'Presets could not be saved. Check browser storage or privacy settings and retry.');
      return false;
    }
    setIdRegionPresets(ordered);
    return true;
  }

  function saveIdRegionPreset() {
    const name=idRegionPresetName.trim();
    if(!name){
      setStatus(zh?'请先填写 ID 区域预设名称。':'Enter a name for the ID-region preset first.');
      return;
    }
    if(idRegionPresets.some(item=>item.name.toLowerCase()===name.toLowerCase())){
      setStatus(zh?'已有同名 ID 区域预设。':'An ID-region preset with that name already exists.');
      return;
    }
    const now=Date.now();
    const preset=createPlayerIdRegionPreset({
      id:`player-id-${now}-${idRegionPresets.length+1}`,
      name,
      regions:effectiveIdRegions(),
      sourceWidth:video.current?.videoWidth||undefined,
      sourceHeight:video.current?.videoHeight||undefined,
      now,
    });
    if(!persistIdRegionPresets([preset,...idRegionPresets]))return;
    setSelectedIdRegionPresetId(preset.id);
    setIdRegionPresetName(preset.name);
    setStatus(zh?`已保存 ID 区域预设：${preset.name}`:`Saved ID-region preset: ${preset.name}`);
  }

  function updateSelectedIdRegionPreset() {
    if(!selectedIdRegionPreset){
      setStatus(zh?'请先选择要覆盖的 ID 区域预设。':'Choose an ID-region preset to update first.');
      return;
    }
    const nextName=idRegionPresetName.trim()||selectedIdRegionPreset.name;
    if(idRegionPresets.some(item=>item.id!==selectedIdRegionPreset.id&&item.name.toLowerCase()===nextName.toLowerCase())){
      setStatus(zh?'已有同名 ID 区域预设。':'An ID-region preset with that name already exists.');
      return;
    }
    const updated=updatePlayerIdRegionPreset(selectedIdRegionPreset,{
      name:nextName,
      regions:effectiveIdRegions(),
      sourceWidth:video.current?.videoWidth||undefined,
      sourceHeight:video.current?.videoHeight||undefined,
    });
    if(!persistIdRegionPresets(idRegionPresets.map(item=>item.id===updated.id?updated:item)))return;
    setIdRegionPresetName(updated.name);
    setStatus(zh?`已更新 ID 区域预设：${updated.name}`:`Updated ID-region preset: ${updated.name}`);
  }

  function loadSelectedIdRegionPreset() {
    if(!selectedIdRegionPreset){
      setStatus(zh?'请先选择 ID 区域预设。':'Choose an ID-region preset first.');
      return;
    }
    const next=readSlots();
    next.playerIds={...selectedIdRegionPreset.regions};
    if(!saveSlots(next))return;
    setStatus(zh?`已载入 ID 区域预设：${selectedIdRegionPreset.name}`:`Loaded ID-region preset: ${selectedIdRegionPreset.name}`);
    setManualScan(value=>value+1);
  }

  function deleteSelectedIdRegionPreset() {
    if(!selectedIdRegionPreset)return;
    if(!persistIdRegionPresets(idRegionPresets.filter(item=>item.id!==selectedIdRegionPreset.id)))return;
    setSelectedIdRegionPresetId('');
    setIdRegionPresetName('');
    setStatus(zh?`已删除 ID 区域预设：${selectedIdRegionPreset.name}`:`Deleted ID-region preset: ${selectedIdRegionPreset.name}`);
  }

  useEffect(()=>{
    if(!calibrationOpen||!ready)return;
    const render=()=>{
      if(!video.current?.videoWidth)return;
      const source=video.current;
      const cropRegion=idRegion(slots,selectedSide,selectedIndex);
      const pixels=regionToPixels(cropRegion,source.videoWidth,source.videoHeight);
      const canvas=document.createElement('canvas');
      const size=playerIdCropSize(pixels.width,pixels.height);
      canvas.width=size.width;
      canvas.height=size.height;
      canvas.getContext('2d')!.drawImage(source,pixels.x,pixels.y,pixels.width,pixels.height,0,0,canvas.width,canvas.height);
      setPreview(canvas.toDataURL('image/png'));
    };
    render();
    const timer=setInterval(render,500);
    return()=>clearInterval(timer);
  },[calibrationOpen,ready,selectedIndex,selectedSide,slots]);

  const confirmedSides=(['blue','red'] as const).filter(side=>scan?.[side]&&(!auto||scan[side]!.automatic)&&sameOrder(state[`${side}PlayerSlotOrder`],scan[side]!.order)).length;
  const recognizedSlots=(['blue','red'] as const).reduce((sum,side)=>sum+(scan?.[side]?.confidence.filter((value,index)=>value>=.8&&!scan[side]!.anomalies.includes(index)).length??0),0);

  function renderTeam(side:Side) {
    const team=state[`${side}Team`];
    const currentOrder=state[`${side}PlayerSlotOrder`];
    const solution=scan?.[side];
    const displayOrder=solution?.order??currentOrder;
    const confirmed=!!solution&&(!auto||solution.automatic)&&sameOrder(currentOrder,solution.order);
    const needsReview=!!solution&&!solution.automatic;
    const statusText=!solution
      ? (zh?'等待识别':'Waiting')
      : confirmed
        ? (zh?'已同步':'Synced')
        : solution.automatic
          ? (solution.verificationFrames&&solution.verificationFrames>=2
            ? (zh?`${solution.verificationFrames} 帧复核通过`:`${solution.verificationFrames}-frame verified`)
            : (zh?'高置信度':'High confidence'))
          : (auto
            ? (zh?`自动复核中${solution.verificationFrames&&solution.verificationFrames>1?` · ${solution.verificationFrames} 帧一致`:''}`:`Retrying OCR${solution.verificationFrames&&solution.verificationFrames>1?` · ${solution.verificationFrames} matching frames`:''}`)
            : (zh?'需确认':'Review'));

    return <article className={`player-slot-team-card ${side}`} key={side}>
      <header>
        <div>
          <span>{side==='blue'?(zh?'蓝方':'Blue'):(zh?'红方':'Red')}</span>
          <strong>{team.name}</strong>
        </div>
        <span className={`player-slot-team-status ${confirmed?'synced':needsReview?'review':solution?'ready':'idle'}`}>{statusText}</span>
      </header>

      <div className="player-slot-result-list">
        {displayOrder.map((roster,index)=>{
          const confidence=solution?.confidence[index];
          const raw=solution?.ocrText?.[index]??scan?.texts[(side==='blue'?0:5)+index]??'';
          const rawConfidence=solution?.ocrConfidence?.[index];
          const variant=solution?.ocrVariant?.[index];
          const badgeClass=confidence===undefined?'idle':confidence>=.9?'high':confidence>=.8?'medium':'low';
          const debugTitle=raw
            ? `${zh?'匹配 OCR':'Matched OCR'}: ${raw}${rawConfidence===undefined?'':` · OCR ${Math.round(rawConfidence*100)}%`}${variant?` · ${variant}`:''}`
            : '';
          return <div className="player-slot-result-row" key={index} title={debugTitle}>
            <span className="player-slot-position">P{index+1}</span>
            <strong>{team.players[roster]||`${zh?'选手':'Player'} ${roster+1}`}</strong>
            {confidence===undefined
              ? <span className="player-slot-confidence idle">{zh?'待识别':'—'}</span>
              : <span className={`player-slot-confidence ${badgeClass}`}>{Math.round(confidence*100)}%</span>}
          </div>;
        })}
      </div>

      <div className="player-slot-card-actions">
        {solution&&!confirmed&&<button disabled={disabled||!!state.committedGameId} onClick={()=>{
          // Freeze the visible proposal before applying it. A background OCR
          // response must not overwrite the operator's explicit choice.
          pauseRecognition();
          apply(side,solution);
        }}>{zh?'采用建议':'Apply suggestion'}</button>}
        <button className="secondary" disabled={disabled||!!state.committedGameId} onClick={()=>setManualEdit(value=>({...value,[side]:!value[side]}))}>
          {manualEdit[side]?(zh?'收起手动调整':'Close manual edit'):(zh?'手动调整':'Manual edit')}
        </button>
      </div>

      {manualEdit[side]&&<div className="player-slot-manual-grid">
        {currentOrder.map((roster,index)=><label key={index}>
          <span>P{index+1}</span>
          <select aria-label={`${side} P${index+1} player`} value={roster} disabled={disabled||!!state.committedGameId} onChange={e=>{
            const order=[...currentOrder];
            const other=order.indexOf(Number(e.target.value));
            if(other<0||other===index)return;
            [order[index],order[other]]=[order[other],order[index]];
            pauseRecognition();
            setScan(undefined);
            send({type:'set_player_slot_order',side,order,expectedPlayers:[...team.players]});
          }}>
            {team.players.map((name,i)=><option key={i} value={i}>{name||`${zh?'选手':'Player'} ${i+1}`}</option>)}
          </select>
        </label>)}
      </div>}

      <footer>{playerAtSlot(state,side,0).id||'—'} → {playerAtSlot(state,side,1).id||'—'} → {playerAtSlot(state,side,2).id||'—'} → {playerAtSlot(state,side,3).id||'—'} → {playerAtSlot(state,side,4).id||'—'}</footer>
    </article>;
  }

  const sourceConnected=!!getSharedWindowCaptureStream()?.getVideoTracks().some(track=>track.readyState==='live');
  const recognitionLabel=scan
    ? (confirmedSides===2?(zh?'双方已同步':'Both synced'):(zh?'已有候选结果':'Candidates ready'))
    : !sourceConnected?(zh?'未连接采集窗口':'Capture disconnected')
      : !ready?(zh?'等待视频画面就绪':'Waiting for video frames')
        : busy?(zh?'OCR 识别中':'OCR running')
          : !auto?(zh?'自动识别已暂停':'Auto recognition paused')
            : status||(zh?'等待 OCR 结果':'Waiting for OCR');

  return <section id="player-slot-alignment" className="panel player-slot-alignment">
    <video className="lineup-capture-video" ref={video} muted playsInline />

    <header className="player-slot-heading">
      <div>
        <span className="player-slot-eyebrow">P1–P5</span>
        <h3>{zh?'选手顺序自动识别':'Player order recognition'}</h3>
        <p>{state.bpInputMode==='screen'
          ? (status||(ready?(zh?'等待本地 OCR…':'Waiting for local OCR…'):(zh?'等待 Auto BP 连接采集窗口':'Waiting for Auto BP capture')))
          : (zh?'当前为手动 BP；可直接调整选手顺序。':'Manual BP mode; player order can be edited directly.')}</p>
      </div>
      {state.bpInputMode==='screen'&&<label className="player-slot-auto-toggle">
        <input type="checkbox" checked={auto} onChange={e=>{
          if(e.target.checked)restoreAutoRecognition();
          else{
            pauseRecognition();
            setStatus(zh?'自动识别已暂停。':'Automatic recognition paused.');
          }
        }} />
        <span>{zh?'自动识别':'Auto align'}</span>
      </label>}
    </header>

    <div className="player-slot-summary">
      <div><span>{zh?'识别状态':'Recognition'}</span><strong>{recognitionLabel}</strong></div>
      <div><span>{zh?'可靠槽位':'Reliable slots'}</span><strong>{scan?`${recognizedSlots}/10`:'—'}</strong></div>
      <div><span>{zh?'本地耗时':'Local OCR'}</span><strong>{scan?`${Math.round(scan.elapsedMs)} ms`:'—'}</strong></div>
      <div className="player-slot-summary-actions">
        {!auto&&<button className="player-slot-restore-auto" disabled={busy||disabled||state.bpInputMode!=='screen'} onClick={restoreAutoRecognition}>
          {zh?'恢复自动识别':'Restore auto'}
        </button>}
        <button disabled={busy||disabled||state.bpInputMode!=='screen'} onClick={requestRescan}>{busy?(zh?'识别中…':'Scanning…'):(zh?'重新识别':'Rescan')}</button>
      </div>
    </div>

    <div className="player-slot-team-grid">
      {(['blue','red'] as const).map(renderTeam)}
    </div>

    {state.bpInputMode==='screen'&&<details className="player-slot-calibration" onToggle={e=>setCalibrationOpen(e.currentTarget.open)}>
      <summary>{zh?'高级：选手 ID 区域校准':'Advanced: player ID region calibration'}</summary>
      <p className="muted">{zh?'默认区域会自动跟随对应 Pick 头像。只有 OCR 截不到完整 ID 时才需要调整。':'Regions follow the Pick avatars by default. Adjust only when OCR misses part of an ID.'}</p>

      <section className="player-id-region-presets">
        <div className="player-id-region-preset-heading">
          <div>
            <strong>{zh?'ID 区域预设':'ID region presets'}</strong>
            <small>{zh?'保存的是 10 个 Player ID 区域，不会改动 18 个 Ban/Pick 英雄框。':'Stores only the 10 Player ID regions; the 18 Ban/Pick hero boxes stay untouched.'}</small>
          </div>
          {selectedIdRegionPreset?.sourceWidth&&selectedIdRegionPreset?.sourceHeight&&<span>{selectedIdRegionPreset.sourceWidth}×{selectedIdRegionPreset.sourceHeight}</span>}
        </div>
        <div className="player-id-region-preset-row">
          <select value={selectedIdRegionPresetId} onChange={e=>{
            const id=e.target.value;
            setSelectedIdRegionPresetId(id);
            const preset=idRegionPresets.find(item=>item.id===id);
            setIdRegionPresetName(preset?.name??'');
          }}>
            <option value="">{zh?'选择预设…':'Choose preset…'}</option>
            {idRegionPresets.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button disabled={!selectedIdRegionPreset} onClick={loadSelectedIdRegionPreset}>{zh?'载入':'Load'}</button>
          <button className="secondary" disabled={!selectedIdRegionPreset} onClick={deleteSelectedIdRegionPreset}>{zh?'删除':'Delete'}</button>
        </div>
        <div className="player-id-region-preset-row">
          <input type="text" maxLength={48} value={idRegionPresetName} placeholder={zh?'例如：HOK 1600×900 默认观战':'e.g. HOK 1600×900 spectator'} onChange={e=>setIdRegionPresetName(e.target.value)} />
          <button onClick={saveIdRegionPreset}>{zh?'保存当前 10 区域':'Save current 10'}</button>
          <button className="secondary" disabled={!selectedIdRegionPreset} onClick={updateSelectedIdRegionPreset}>{zh?'覆盖所选预设':'Update selected'}</button>
        </div>
      </section>

      <div className="player-slot-calibration-grid">
        <div className="player-slot-calibration-controls">
          <label>{zh?'槽位':'Slot'}
            <select aria-label="Player ID region" value={selected} onChange={e=>setSelected(e.target.value)}>
              {(['blue','red'] as const).flatMap(side=>Array.from({length:5},(_,i)=><option key={`${side}${i+1}`} value={`${side}${i+1}`}>{side} P{i+1}</option>))}
            </select>
          </label>

          <div className="player-slot-nudge-grid">
            <span />
            <button onClick={()=>updateSelectedRegion({...region,y:region.y-.005})}>↑</button>
            <span />
            <button onClick={()=>updateSelectedRegion({...region,x:region.x-.005})}>←</button>
            <button onClick={()=>updateSelectedRegion({...region,y:region.y+.005})}>↓</button>
            <button onClick={()=>updateSelectedRegion({...region,x:region.x+.005})}>→</button>
          </div>

          <div className="player-slot-size-actions">
            <button onClick={()=>updateSelectedRegion({...region,width:region.width+.01})}>{zh?'加宽':'W +'}</button>
            <button onClick={()=>updateSelectedRegion({...region,width:Math.max(.02,region.width-.01)})}>{zh?'缩窄':'W −'}</button>
            <button onClick={()=>updateSelectedRegion({...region,height:region.height+.005})}>{zh?'加高':'H +'}</button>
            <button onClick={()=>updateSelectedRegion({...region,height:Math.max(.02,region.height-.005)})}>{zh?'变矮':'H −'}</button>
          </div>

          <div className="player-slot-reset-actions">
            <button className="secondary" onClick={resetSelectedRegion}>{zh?'恢复当前默认':'Reset slot'}</button>
            <button className="secondary" onClick={resetAllIdRegions}>{zh?'恢复全部默认':'Reset all'}</button>
          </div>

          <button type="button" disabled={!ready} onClick={()=>{
            const source=video.current;if(!source?.videoWidth)return;
            const canvas=document.createElement('canvas');canvas.width=source.videoWidth;canvas.height=source.videoHeight;canvas.getContext('2d')!.drawImage(source,0,0);
            setCalibrationSnapshot(canvas.toDataURL('image/jpeg',.92));
          }}>{zh?'预览 BP 画面并框选 ID':'Preview BP frame and draw ID regions'}</button>
        </div>

        <figure className="player-slot-crop-preview">
          <figcaption>{zh?'实际 OCR 裁剪预览':'Actual OCR crop'}</figcaption>
          {preview?<img src={preview} alt={zh?'实际选手 ID 裁剪':'Actual player ID crop'}/>:<div>{zh?'等待采集画面':'Waiting for capture'}</div>}
          <figcaption>{zh?'上次匹配文字：':'Last matched text: '}{scan?.[selectedSide]?.ocrText?.[selectedIndex]|| (zh?'尚无文字结果':'No text result yet')}</figcaption>
          <button type="button" disabled={!scan||busy||!lastSample.current} onClick={saveRecognitionSample}>{zh?'保存识别样本':'Save recognition sample'}</button>
          <figcaption>{zh?'保存上次识别的十格裁片、选手 ID 和识别结果到本地文件。':'Save the last ten crops, player IDs and recognition results locally.'}</figcaption>
        </figure>
      </div>
      {calibrationSnapshot&&<CaptureRegionPicker image={calibrationSnapshot} selected={selected} label="Player ID region selection" zh={zh}
        regions={(['blue','red'] as const).flatMap(side=>Array.from({length:5},(_,i)=>({id:`${side}${i+1}`,label:`${side} P${i+1}`,region:idRegion(slots,side,i)})))} onChange={updateSelectedRegion}/>}
    </details>}
  </section>;
}
