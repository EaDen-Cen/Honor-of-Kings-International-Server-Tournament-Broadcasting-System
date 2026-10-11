import { shouldAutoAcceptRecognition } from './recognitionAcceptance';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { heroForState } from '../shared/heroData';
import {
  captureProbeForNextOpponentPick,
  captureSlotKeys,
  captureTargetForState,
  captureTargetsForCurrentTurn,
  defaultCaptureSlots,
  normalizeCaptureSlots,
  slotMeta,
  slotsFromLegacyZones,
  type CaptureSlotKey,
  type CaptureSlots,
  type LegacyCaptureZones,
} from './bpCaptureLayout';
import { detectEmptyBan, EMPTY_BAN_GRACE_MS, EMPTY_BAN_MAX_HERO_CONFIDENCE, fingerprintDistance, type EmptyBanStability } from './emptyBanDetection';
import { updateHeroRecognitionStability, type HeroRecognitionStability } from './heroRecognitionStability';
import { freshHeroLockStability, updateHeroLockStability, type HeroLockStability } from './heroLockDetection';
import { freshPickSlotActivationState, updatePickSlotActivation, type PickSlotActivationState } from './pickSlotActivation';
import { getSharedWindowCaptureStream, requestWindowCapture, setSharedWindowCaptureStream } from './sharedWindowCapture';
import { freshPickTurnDimState, updatePickTurnDimState, type PickTurnDimState } from './pickTurnDimDetection';
import { regionFromDrag, regionToPixels, type NormalizedCaptureRegion } from './windowCaptureGeometry';
import { nextCaptureSlotKey, nudgeCaptureRegion, type CalibrationDelta } from './precisionCalibration';
import {
  CAPTURE_PRESETS_STORAGE,
  createCaptureSlotPreset,
  readCaptureSlotPresets,
  updateCaptureSlotPreset,
  type CaptureSlotPreset,
} from './captureSlotPresets';
import { phaseName } from '../shared/display';
import { translator } from '../shared/i18n';
import { phases, type Action, type MatchState } from '../shared/types';
import { immediateNextTurnIsBan } from '../shared/draftTurns';

type HeroCandidate = { heroId:number; confidence:number };

type SingleCaptureResult = {
  kind: 'hero' | 'empty-ban';
  candidates: HeroCandidate[];
  preview: string;
  at: number;
};

type PickGroupCaptureResult = {
  kind: 'pick-group';
  team:'blue'|'red';
  entries:Array<{
    key:CaptureSlotKey;
    candidates:HeroCandidate[];
    preview:string;
  }>;
  at:number;
};

type CaptureResult = SingleCaptureResult | PickGroupCaptureResult;

type WindowInfo = {
  label:string;
  surface:string;
  width:number;
  height:number;
};

type RecognitionResponse = {
  candidates?: HeroCandidate[];
  preview:string;
  fingerprint?:string;
  lockFingerprint?:string;
  meanLuma?:number;
};

const freshEmptyStability = (): EmptyBanStability => ({ phaseKey:'', fingerprint:'', count:0 });
const freshHeroStability = (): HeroRecognitionStability => ({ phaseKey:'', heroId:null, count:0 });
const SLOTS_STORAGE='hok-window-capture-slots-v3';
const LEGACY_ZONES_STORAGE='hok-window-capture-zones-v2';

function readCaptureSlots() {
  try {
    const value=JSON.parse(localStorage.getItem(SLOTS_STORAGE)||'null');
    if(value&&typeof value==='object') return normalizeCaptureSlots(value);
  } catch { /* use migration/defaults */ }

  try {
    const legacy=JSON.parse(localStorage.getItem(LEGACY_ZONES_STORAGE)||'null') as LegacyCaptureZones|null;
    if(legacy&&typeof legacy==='object'&&legacy.bluePick&&legacy.redPick&&legacy.blueBan&&legacy.redBan) {
      return normalizeCaptureSlots(slotsFromLegacyZones(legacy));
    }
  } catch { /* use defaults */ }

  return normalizeCaptureSlots(defaultCaptureSlots);
}

function pointInElement(event:React.PointerEvent<HTMLElement>) {
  const rect=event.currentTarget.getBoundingClientRect();
  return {
    x:Math.min(1,Math.max(0,(event.clientX-rect.left)/Math.max(rect.width,1))),
    y:Math.min(1,Math.max(0,(event.clientY-rect.top)/Math.max(rect.height,1))),
  };
}

function percentageStyle(region:{x:number;y:number;width:number;height:number}) {
  return {
    left:`${region.x*100}%`,
    top:`${region.y*100}%`,
    width:`${region.width*100}%`,
    height:`${region.height*100}%`,
  };
}

export function ScreenInput({ state, revision, token, disabled, send }: { state:MatchState; revision:number; token:string; disabled:boolean; send:(action:Action)=>void }) {
  const zh=state.language==='zh';
  const t=translator(state.language);
  const [slots,setSlots]=useState<CaptureSlots>(readCaptureSlots);
  useEffect(()=>{const refresh=()=>setSlots(readCaptureSlots());window.addEventListener('hok-capture-slots-changed',refresh);return()=>window.removeEventListener('hok-capture-slots-changed',refresh);},[]);
  const [autoWatch,setAutoWatch]=useState(()=>localStorage.getItem('hok-capture-auto-watch')==='1');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [candidateStatus,setCandidateStatus]=useState('');
  const [result,setResult]=useState<CaptureResult>();
  const [manualResult,setManualResult]=useState<CaptureResult>();
  const [selected,setSelected]=useState(0);
  const [groupSelected,setGroupSelected]=useState<Record<string,number>>({});
  const [windowInfo,setWindowInfo]=useState<WindowInfo>();
  const [calibratingSlot,setCalibratingSlot]=useState<CaptureSlotKey>();
  const [videoReady,setVideoReady]=useState(false);
  const [precisionMode,setPrecisionMode]=useState(false);
  const [calibrationZoom,setCalibrationZoom]=useState(2);
  const [calibrationPreview,setCalibrationPreview]=useState('');
  const [capturePresets,setCapturePresets]=useState<CaptureSlotPreset[]>(()=>readCaptureSlotPresets(localStorage.getItem(CAPTURE_PRESETS_STORAGE)));
  const [selectedCapturePresetId,setSelectedCapturePresetId]=useState('');
  const [capturePresetName,setCapturePresetName]=useState('');

  const dialog=useRef<HTMLDialogElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null);
  const precisionWorkspace=useRef<HTMLDivElement>(null);
  const streamRef=useRef<MediaStream>();
  const mounted=useRef(true);
  const busyRef=useRef(false);
  const dragStart=useRef<{x:number;y:number}|null>(null);
  const emptyStability=useRef<EmptyBanStability>(freshEmptyStability());
  const heroStability=useRef<HeroRecognitionStability>(freshHeroStability());
  const heroLockStability=useRef<HeroLockStability>(freshHeroLockStability());
  const pickSlotStability=useRef<Record<string,HeroRecognitionStability>>({});
  const nextPickActivation=useRef<PickSlotActivationState>(freshPickSlotActivationState());
  const pickTurnDimState=useRef<PickTurnDimState>(freshPickTurnDimState());
  const phaseStartedAt=useRef(Date.now());
  const emptyPromptedPhase=useRef('');
  const lockBaseline=useRef<{phaseKey:string;fingerprint:string}>({phaseKey:'',fingerprint:''});

  const phase=phases(state.draftMode,state.firstPickSide)[state.currentPhase];
  const phaseKey=`${state.draftGameNumber ?? state.gameNumber}:${state.currentPhase}:${phase?.team ?? 'done'}:${phase?.action ?? 'done'}`;
  const target=useMemo(()=>captureTargetForState(state,slots),[state,slots]);
  const turnTargets=useMemo(()=>captureTargetsForCurrentTurn(state,slots),[state,slots]);
  const nextOpponentPickProbe=useMemo(()=>captureProbeForNextOpponentPick(state,slots),[state,slots]);
  const pickToBanBoundary=phase?.action==='pick'&&immediateNextTurnIsBan(state.draftMode,state.firstPickSide,state.currentPhase);
  const useHighlightRelease=phase?.action==='pick'&&(pickToBanBoundary||!nextOpponentPickProbe);
  const activeTargetKeys=useMemo(()=>new Set(turnTargets.map(item=>item.key)),[turnTargets]);
  const selectedCapturePreset=useMemo(()=>capturePresets.find(item=>item.id===selectedCapturePresetId),[capturePresets,selectedCapturePresetId]);

  const label=useCallback((id:number)=>{
    const hero=heroForState(state,id);
    return zh?hero?.chineseName??String(id):hero?.englishName??String(id);
  },[state,zh]);

  const captureSlotLabel=useCallback((key:CaptureSlotKey)=>{
    const meta=slotMeta(key);
    return t('captureExplicitSlot',{
      side:t(meta.side==='blue'?'blueSide':'redSide'),
      action:t(meta.action==='ban'?'banAction':'pickAction'),
      number:meta.index+1,
    });
  },[t]);

  const buildCalibrationPreview=useCallback((region:NormalizedCaptureRegion)=>{
    const video=videoRef.current;
    if(!videoReady||!video||!video.videoWidth||!video.videoHeight) return '';
    const pixels=regionToPixels(region,video.videoWidth,video.videoHeight);
    const maxSide=260;
    const scale=Math.min(1,maxSide/Math.max(pixels.width,pixels.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(pixels.width*scale));
    canvas.height=Math.max(1,Math.round(pixels.height*scale));
    const context=canvas.getContext('2d');
    if(!context) return '';
    context.imageSmoothingEnabled=false;
    context.drawImage(video,pixels.x,pixels.y,pixels.width,pixels.height,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/png');
  },[videoReady]);

  const persistCalibrationSlot=useCallback((key:CaptureSlotKey,region:NormalizedCaptureRegion)=>{
    const updated={...slots,[key]:region};
    setSlots(updated);
    localStorage.setItem(SLOTS_STORAGE,JSON.stringify(updated));
    window.dispatchEvent(new Event('hok-capture-slots-changed'));
    setCalibrationPreview(buildCalibrationPreview(region));
    return updated;
  },[buildCalibrationPreview,slots]);

  const selectCalibrationSlot=useCallback((key:CaptureSlotKey)=>{
    setCalibratingSlot(key);
    setCalibrationPreview(buildCalibrationPreview(slots[key]));
  },[buildCalibrationPreview,slots]);

  const persistCapturePresets=useCallback((next:CaptureSlotPreset[])=>{
    const ordered=[...next].sort((a,b)=>b.updatedAt-a.updatedAt);
    setCapturePresets(ordered);
    localStorage.setItem(CAPTURE_PRESETS_STORAGE,JSON.stringify(ordered));
  },[]);

  const saveCapturePreset=useCallback(()=>{
    const name=capturePresetName.trim();
    if(!name){
      setMessage(t('capturePresetNameRequired'));
      return;
    }
    if(capturePresets.some(item=>item.name.toLowerCase()===name.toLowerCase())){
      setMessage(t('capturePresetNameDuplicate'));
      return;
    }
    const now=Date.now();
    const preset=createCaptureSlotPreset({
      id:`capture-${now}-${capturePresets.length+1}`,
      name,
      slots,
      sourceWidth:windowInfo?.width,
      sourceHeight:windowInfo?.height,
      now,
    });
    persistCapturePresets([preset,...capturePresets]);
    setSelectedCapturePresetId(preset.id);
    setCapturePresetName(preset.name);
    setMessage(t('capturePresetSaved',{name:preset.name}));
  },[capturePresetName,capturePresets,persistCapturePresets,slots,t,windowInfo?.height,windowInfo?.width]);

  const updateSelectedCapturePreset=useCallback(()=>{
    if(!selectedCapturePreset){
      setMessage(t('capturePresetChooseFirst'));
      return;
    }
    const nextName=capturePresetName.trim()||selectedCapturePreset.name;
    const duplicate=capturePresets.some(item=>item.id!==selectedCapturePreset.id&&item.name.toLowerCase()===nextName.toLowerCase());
    if(duplicate){
      setMessage(t('capturePresetNameDuplicate'));
      return;
    }
    const updated=updateCaptureSlotPreset(selectedCapturePreset,{
      name:nextName,
      slots,
      sourceWidth:windowInfo?.width,
      sourceHeight:windowInfo?.height,
    });
    persistCapturePresets(capturePresets.map(item=>item.id===updated.id?updated:item));
    setCapturePresetName(updated.name);
    setMessage(t('capturePresetUpdated',{name:updated.name}));
  },[capturePresetName,capturePresets,persistCapturePresets,selectedCapturePreset,slots,t,windowInfo?.height,windowInfo?.width]);

  const loadSelectedCapturePreset=useCallback(()=>{
    if(!selectedCapturePreset){
      setMessage(t('capturePresetChooseFirst'));
      return;
    }
    const next=normalizeCaptureSlots(selectedCapturePreset.slots);
    setSlots(next);
    localStorage.setItem(SLOTS_STORAGE,JSON.stringify(next));
    window.dispatchEvent(new Event('hok-capture-slots-changed'));
    setCalibratingSlot(undefined);
    setCalibrationPreview('');
    setMessage(t('capturePresetLoaded',{name:selectedCapturePreset.name}));
  },[selectedCapturePreset,t]);

  const deleteSelectedCapturePreset=useCallback(()=>{
    if(!selectedCapturePreset){
      setMessage(t('capturePresetChooseFirst'));
      return;
    }
    if(!window.confirm(t('capturePresetDeleteConfirm',{name:selectedCapturePreset.name}))) return;
    persistCapturePresets(capturePresets.filter(item=>item.id!==selectedCapturePreset.id));
    setSelectedCapturePresetId('');
    setCapturePresetName('');
    setMessage(t('capturePresetDeleted',{name:selectedCapturePreset.name}));
  },[capturePresets,persistCapturePresets,selectedCapturePreset,t]);


  const enterPrecisionCalibration=useCallback(async()=>{
    if(!videoReady) return;
    const key=calibratingSlot??target?.key??captureSlotKeys[0];
    selectCalibrationSlot(key);
    setCalibrationZoom(2);
    setPrecisionMode(true);
    try{
      const workspace=precisionWorkspace.current;
      if(workspace?.requestFullscreen&&document.fullscreenElement!==workspace) await workspace.requestFullscreen();
    }catch{
      // The fixed-position precision workspace still works when Fullscreen API is unavailable.
    }
  },[calibratingSlot,selectCalibrationSlot,target?.key,videoReady]);

  const exitPrecisionCalibration=useCallback(async()=>{
    setPrecisionMode(false);
    if(document.fullscreenElement===precisionWorkspace.current){
      try{ await document.exitFullscreen(); }catch{ /* already leaving fullscreen */ }
    }
  },[]);

  const adjustCalibration=useCallback((delta:CalibrationDelta)=>{
    const key=calibratingSlot;
    const video=videoRef.current;
    if(!key||!videoReady||!video?.videoWidth||!video.videoHeight) return;
    const region=nudgeCaptureRegion(slots[key],video.videoWidth,video.videoHeight,delta);
    persistCalibrationSlot(key,region);
  },[calibratingSlot,persistCalibrationSlot,slots,videoReady]);

  const moveCalibrationSelection=useCallback((direction:1|-1)=>{
    const current=calibratingSlot??target?.key??captureSlotKeys[0];
    selectCalibrationSlot(nextCaptureSlotKey(current,direction));
  },[calibratingSlot,selectCalibrationSlot,target?.key]);

  const stopWindowCapture=useCallback(()=>{
    const stream=streamRef.current;
    streamRef.current=undefined;
    if(getSharedWindowCaptureStream()===stream) setSharedWindowCaptureStream(undefined);
    if(stream) stream.getTracks().forEach(track=>track.stop());
    if(videoRef.current) videoRef.current.srcObject=null;
    setVideoReady(false);
    setWindowInfo(undefined);
    setCalibratingSlot(undefined);
  },[]);

  useEffect(()=>{
    mounted.current=true;
    return()=>{
      mounted.current=false;
      const stream=streamRef.current;
      if(stream) stream.getTracks().forEach(track=>track.stop());
    };
  },[]);
  useEffect(()=>{
    const preventZoomKeys=(event:KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey)) return;
      if(['+','=','-','0'].includes(event.key)) event.preventDefault();
    };
    const preventZoomWheel=(event:WheelEvent)=>{
      if(event.ctrlKey||event.metaKey) event.preventDefault();
    };
    window.addEventListener('keydown',preventZoomKeys,{capture:true});
    window.addEventListener('wheel',preventZoomWheel,{capture:true,passive:false});
    return()=>{
      window.removeEventListener('keydown',preventZoomKeys,{capture:true});
      window.removeEventListener('wheel',preventZoomWheel,{capture:true});
    };
  },[]);

  useEffect(()=>{
    const onFullscreenChange=()=>{
      if(document.fullscreenElement!==precisionWorkspace.current&&precisionMode) setPrecisionMode(false);
    };
    document.addEventListener('fullscreenchange',onFullscreenChange);
    return()=>document.removeEventListener('fullscreenchange',onFullscreenChange);
  },[precisionMode]);

  useEffect(()=>{
    if(!precisionMode) return;
    const onKeyDown=(event:KeyboardEvent)=>{
      const element=event.target;
      if(element instanceof HTMLInputElement||element instanceof HTMLSelectElement||element instanceof HTMLTextAreaElement) return;

      if(event.key==='Escape'){
        event.preventDefault();
        void exitPrecisionCalibration();
        return;
      }
      if(event.key==='Enter'){
        event.preventDefault();
        moveCalibrationSelection(1);
        return;
      }
      if(event.key==='['){
        event.preventDefault();
        moveCalibrationSelection(-1);
        return;
      }
      if(event.key===']'){
        event.preventDefault();
        moveCalibrationSelection(1);
        return;
      }
      if(event.key==='+'||event.key==='='){
        event.preventDefault();
        setCalibrationZoom(value=>Math.min(4,Math.round((value+.25)*100)/100));
        return;
      }
      if(event.key==='-'){
        event.preventDefault();
        setCalibrationZoom(value=>Math.max(1,Math.round((value-.25)*100)/100));
        return;
      }

      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if(event.shiftKey){
        if(event.key==='ArrowLeft') adjustCalibration({dw:-1});
        if(event.key==='ArrowRight') adjustCalibration({dw:1});
        if(event.key==='ArrowUp') adjustCalibration({dh:-1});
        if(event.key==='ArrowDown') adjustCalibration({dh:1});
      }else{
        if(event.key==='ArrowLeft') adjustCalibration({dx:-1});
        if(event.key==='ArrowRight') adjustCalibration({dx:1});
        if(event.key==='ArrowUp') adjustCalibration({dy:-1});
        if(event.key==='ArrowDown') adjustCalibration({dy:1});
      }
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[adjustCalibration,exitPrecisionCalibration,moveCalibrationSelection,precisionMode]);


  useEffect(()=>{
    emptyStability.current=freshEmptyStability();
    heroStability.current=freshHeroStability();
    heroLockStability.current=freshHeroLockStability();
    pickSlotStability.current={};
    nextPickActivation.current=freshPickSlotActivationState();
    pickTurnDimState.current=freshPickTurnDimState();
    phaseStartedAt.current=Date.now();
    emptyPromptedPhase.current='';
    lockBaseline.current={phaseKey,fingerprint:''};
    setResult(undefined);
    setManualResult(undefined);
    setGroupSelected({});
    setMessage('');
    setCandidateStatus('');
  },[phaseKey]);

  useEffect(()=>{
    if(!result||!dialog.current||dialog.current.open) return;
    dialog.current.showModal();
  },[result]);

  const connectWindow=useCallback(async()=>{
    if(!navigator.mediaDevices?.getDisplayMedia){
      setMessage(t('windowCaptureUnsupported'));
      return;
    }
    try{
      stopWindowCapture();
      setMessage('');
      const stream=await requestWindowCapture();
      if(!mounted.current){
        stream.getTracks().forEach(track=>track.stop());
        return;
      }
      streamRef.current=stream;
      setSharedWindowCaptureStream(stream);
      const video=videoRef.current;
      if(!video) throw new Error('Preview unavailable');
      video.srcObject=stream;
      video.muted=true;
      await video.play();
      if(video.readyState<1){
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Capture metadata timeout')),5000);
          video.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});
        });
      }
      const track=stream.getVideoTracks()[0];
      const settings=track.getSettings();
      setWindowInfo({
        label:track.label||t('windowCaptureConnected'),
        surface:String(settings.displaySurface||'window'),
        width:video.videoWidth||settings.width||0,
        height:video.videoHeight||settings.height||0,
      });
      setVideoReady(true);
      track.addEventListener('ended',()=>{
        if(!mounted.current) return;
        streamRef.current=undefined;
        if(getSharedWindowCaptureStream()===stream) setSharedWindowCaptureStream(undefined);
        setVideoReady(false);
        setWindowInfo(undefined);
        setCalibratingSlot(undefined);
        setMessage(t('windowCaptureEnded'));
      },{once:true});
      setMessage(t('windowCaptureConnected'));
    }catch(error){
      stopWindowCapture();
      if(!mounted.current) return;
      const denied=error instanceof DOMException&&['NotAllowedError','AbortError'].includes(error.name);
      setMessage(denied?t('windowCaptureCancelled'):t('windowCaptureFailed'));
    }
  },[stopWindowCapture,t]);

  const captureWindowFrame=useCallback((region?:NormalizedCaptureRegion)=>{
    const video=videoRef.current;
    if(!videoReady||!video||!video.videoWidth||!video.videoHeight) throw new Error(t('windowCaptureNotConnected'));
    const sourceRegion=region??target?.region;
    if(!sourceRegion) throw new Error(t('captureNoActiveSlot'));
    const pixels=regionToPixels(sourceRegion,video.videoWidth,video.videoHeight);
    const maxSide=384;
    const scale=Math.min(1,maxSide/Math.max(pixels.width,pixels.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(32,Math.round(pixels.width*scale));
    canvas.height=Math.max(32,Math.round(pixels.height*scale));
    const context=canvas.getContext('2d');
    if(!context) throw new Error('Canvas unavailable');
    context.imageSmoothingEnabled=true;
    context.imageSmoothingQuality='high';
    context.drawImage(
      video,
      pixels.x,pixels.y,pixels.width,pixels.height,
      0,0,canvas.width,canvas.height,
    );
    return canvas.toDataURL('image/png');
  },[target?.region,t,videoReady]);

  const recognizeWindowRegion=useCallback(async(
    region:NormalizedCaptureRegion,
    options?:{allowedHeroIds?:number[];shape?:'square'|'circle'},
  )=>{
    const image=captureWindowFrame(region);
    const response=await fetch('/api/recognize-frame',{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        image,
        revision,
        allowedHeroIds:options?.allowedHeroIds,
        shape:options?.shape??'square',
      }),
      signal:AbortSignal.timeout(25000),
    });
    const data:RecognitionResponse=await response.json();
    if(!response.ok) throw new Error(t('windowCaptureRecognitionFailed'));
    return data;
  },[captureWindowFrame,revision,t,token]);

  const capture=useCallback(async()=>{
    if(busyRef.current||disabled||!phase||state.committedGameId) return;
    busyRef.current=true;
    setBusy(true);
    setMessage('');
    try{
      if(phase.action==='pick'){
        const responses=await Promise.all(turnTargets.map(item=>recognizeWindowRegion(item.region,{shape:'square'})));
        if(!mounted.current) return;

        let probeData:RecognitionResponse|undefined;
        let probeActivation;
        if(!useHighlightRelease&&nextOpponentPickProbe){
          probeData=await recognizeWindowRegion(nextOpponentPickProbe.region,{shape:'square'});
          const probeTop=probeData.candidates?.[0];
          probeActivation=updatePickSlotActivation(nextPickActivation.current,{
            phaseKey,
            slotKey:nextOpponentPickProbe.key,
            fingerprint:probeData.fingerprint,
            heroId:probeTop?.heroId,
            confidence:probeTop?.confidence,
          });
          nextPickActivation.current=probeActivation.state;
        }

        const scanned=turnTargets.map((item,index)=>{
          const data=responses[index];
          const candidates=data.candidates??[];
          const stabilityKey=`${phaseKey}:${item.key}`;
          const evidence=updateHeroRecognitionStability(
            pickSlotStability.current[item.key]??freshHeroStability(),
            stabilityKey,
            candidates,
          );
          pickSlotStability.current[item.key]=evidence.stability;
          return {item,data,candidates,evidence};
        });

        const allStable=scanned.length>0&&scanned.every(entry=>entry.evidence.accepted&&entry.evidence.top);
        const heroIds=scanned.map(entry=>entry.evidence.top?.heroId).filter((id):id is number=>id!==undefined);
        const distinctHeroes=heroIds.length===scanned.length&&new Set(heroIds).size===heroIds.length;
        const lumas=scanned.map(entry=>entry.data.meanLuma??0);
        if(scanned.length>0&&scanned.every(entry=>entry.candidates[0])) {
          setManualResult({
            kind:'pick-group',
            team:phase.team,
            entries:scanned.map(entry=>({
              key:entry.item.key,
              candidates:entry.candidates,
              preview:entry.data.preview,
            })),
            at:Date.now(),
          });
        }

        const highlightRelease=updatePickTurnDimState(pickTurnDimState.current,{
          phaseKey,
          meanLumas:lumas,
          candidatesStable:allStable&&distinctHeroes,
          dropRatio:.08,
        });
        pickTurnDimState.current=highlightRelease.state;

        const status=scanned.map(entry=>{
          const top=entry.evidence.top;
          if(!top) return `${captureSlotLabel(entry.item.key)} · —`;
          const progress=entry.evidence.requiredScans
            ? `${entry.evidence.stability.count}/${entry.evidence.requiredScans}`
            : '—';
          return `${captureSlotLabel(entry.item.key)} · ${label(top.heroId)} ${Math.round(top.confidence*100)}% · ${progress}`;
        }).join(' | ');
        setCandidateStatus(status||t('captureNoCandidate'));

        if(!allStable){
          setMessage(zh
            ? (turnTargets.length>1?'当前为同时选人阶段，正在等待两个 Pick 位都稳定。':'正在等待当前 Pick 位英雄稳定。')
            : (turnTargets.length>1?'Simultaneous pick turn: waiting for both slots to stabilize.':'Waiting for the current pick to stabilize.'));
          return;
        }
        if(!distinctHeroes){
          setMessage(zh?'同时选人阶段识别到了重复英雄，请继续扫描或重新校准槽位。':'The simultaneous pick turn resolved to duplicate heroes; keep scanning or recalibrate.');
          return;
        }

        if(useHighlightRelease){
          if(!highlightRelease.locked){
            setMessage(zh
              ? `当前 Pick 已稳定；${pickToBanBoundary?'下一阶段直接进入 Ban':'已无下一个对手 Pick'}，等待选手行从选角高亮恢复到正常亮度（当前亮度回落 ${Math.round(highlightRelease.dropRatio*100)}%）。`
              : `Current pick is stable; ${pickToBanBoundary?'the next stage is Ban':'there is no next opponent Pick'}, so waiting for the active-row highlight to return to normal (current luma drop ${Math.round(highlightRelease.dropRatio*100)}%).`);
            return;
          }
        }else{
          if(!nextOpponentPickProbe||!probeActivation?.active){
            const nextTop=probeData?.candidates?.[0];
            setMessage(zh
              ? `当前 Pick 组已稳定；只等待对手下一个 Pick 位 ${nextOpponentPickProbe?captureSlotLabel(nextOpponentPickProbe.key):'—'} 真正出现预选英雄。空槽的英雄相似匹配不会触发锁定${nextTop?`（当前候选 ${label(nextTop.heroId)} ${Math.round(nextTop.confidence*100)}%）`:''}。`
              : `Current pick group is stable. Waiting only for the opponent's next Pick slot ${nextOpponentPickProbe?captureSlotLabel(nextOpponentPickProbe.key):'—'} to visibly begin preselecting. Hero-like matches on an empty slot cannot lock the turn${nextTop?` (candidate ${label(nextTop.heroId)} ${Math.round(nextTop.confidence*100)}%)`:''}.`);
            return;
          }
        }

        const selections=Object.fromEntries(scanned.map(entry=>[
          entry.item.key,
          entry.evidence.top!.heroId,
        ]));
        if (shouldAutoAcceptRecognition(state.recognitionAutoAccept,state.recognitionThreshold,scanned.map(entry=>entry.evidence.top!.confidence))) {
          send({type:'draft_pick_group', team:phase.team, heroIds:scanned.map(entry=>entry.evidence.top!.heroId)});
          return;
        }
        setGroupSelected(selections);
        setResult({
          kind:'pick-group',
          team:phase.team,
          entries:scanned.map(entry=>({
            key:entry.item.key,
            candidates:entry.candidates,
            preview:entry.data.preview,
          })),
          at:Date.now(),
        });
        setMessage(zh
          ? (useHighlightRelease?'检测到选角高亮已经恢复，当前 Pick 组视为锁定。':'检测到对手下一个 Pick 位真正开始预选，当前 Pick 组视为锁定。')
          : (useHighlightRelease?'Active Pick highlight returned to normal; current Pick group is locked.':'The opponent next Pick slot visibly started preselecting; current Pick group is locked.'));
        return;
      }

      if(!target) throw new Error(t('captureNoActiveSlot'));
      const data=await recognizeWindowRegion(target.region,{shape:'circle'});
      if(!mounted.current) return;

      const candidates=data.candidates??[];
      const heroEvidence=updateHeroRecognitionStability(heroStability.current,phaseKey,candidates);
      heroStability.current=heroEvidence.stability;
      const top=heroEvidence.top;
      const heroLock=updateHeroLockStability(heroLockStability.current,{
        phaseKey,
        heroId:top?.heroId,
        lockFingerprint:data.lockFingerprint,
        stabilityCount:heroEvidence.stability.count,
        requiredScans:heroEvidence.requiredScans,
      });
      heroLockStability.current=heroLock.stability;
      const elapsedMs=Date.now()-phaseStartedAt.current;

      if(phase.action==='ban' && data.lockFingerprint && !lockBaseline.current.fingerprint){
        lockBaseline.current={phaseKey,fingerprint:data.lockFingerprint};
      }
      const lockCueDistance=phase.action==='ban' && data.lockFingerprint && lockBaseline.current.fingerprint
        ? fingerprintDistance(lockBaseline.current.fingerprint,data.lockFingerprint)
        : undefined;

      const trustedBanHero=(top?.confidence??0)>=.60;
      if(top&&(top.confidence??0)>=.50) {
        setManualResult({kind:'hero',candidates,preview:data.preview,at:Date.now()});
      }
      const empty=detectEmptyBan(emptyStability.current,{
        phaseKey,
        isBan:phase.action==='ban',
        fingerprint:data.fingerprint,
        topConfidence:top?.confidence,
        elapsedMs,
        suppressed:emptyPromptedPhase.current===phaseKey,
        lockCueDistance,
      });
      emptyStability.current=empty.stability;

      if(heroEvidence.accepted&&top&&trustedBanHero&&heroLock.locked){
        if (shouldAutoAcceptRecognition(state.recognitionAutoAccept,state.recognitionThreshold,[top.confidence])) {
          send({type:'draft_action', heroId:top.heroId, team:phase.team, action:phase.action});
          return;
        }
        setSelected(top.heroId);
        setCandidateStatus(t('captureHeroStable',{
          hero:label(top.heroId),
          confidence:Math.round(top.confidence*100),
          count:heroEvidence.stability.count,
          required:heroEvidence.requiredScans,
        }));
        setResult({kind:'hero',candidates,preview:data.preview,at:Date.now()});
        return;
      }

      if(top){
        if(!trustedBanHero){
          setCandidateStatus(zh
            ? `${label(top.heroId)} · ${Math.round(top.confidence*100)}% · 低相似度，按空 Ban 候选处理`
            : `${label(top.heroId)} · ${Math.round(top.confidence*100)}% · low similarity; treated as an empty-Ban candidate`);
        }else if(heroEvidence.accepted&&!heroLock.locked){
          setCandidateStatus(zh
            ? label(top.heroId)+' · '+Math.round(top.confidence*100)+'% · 英雄已稳定，等待锁定'
            : label(top.heroId)+' · '+Math.round(top.confidence*100)+'% · stable, waiting for lock');
        }else{
          setCandidateStatus(t('captureHeroCandidate',{
            hero:label(top.heroId),
            confidence:Math.round(top.confidence*100),
            count:heroEvidence.stability.count,
            required:heroEvidence.requiredScans || '—',
          }));
        }
      }else{
        setCandidateStatus(t('captureNoCandidate'));
      }

      if(empty.suspected){
        emptyPromptedPhase.current=phaseKey;
        setResult({kind:'empty-ban',candidates,preview:data.preview,at:Date.now()});
        setMessage(t('emptyBanSuspected',{count:2}));
        return;
      }else if(heroEvidence.accepted&&top&&trustedBanHero&&!heroLock.locked){
        setMessage(zh?'英雄已稳定，等待游戏内锁定标记。':'Hero stable; waiting for the in-game lock cue.');
        return;
      }

      if(phase.action==='ban'&&empty.waitingForGracePeriod){
        const remaining=Math.max(0,Math.ceil((EMPTY_BAN_GRACE_MS-elapsedMs)/1000));
        setMessage(t('emptyBanGraceWaiting',{seconds:remaining}));
      }else if(phase.action==='ban'&&emptyPromptedPhase.current===phaseKey){
        setMessage(t('emptyBanSuppressed'));
      }else if(phase.action==='ban'&&empty.lockCueDetected&&(top?.confidence??0)<EMPTY_BAN_MAX_HERO_CONFIDENCE){
        setMessage(t('emptyBanLockCueWaiting',{count:empty.stability.count}));
      }else if(phase.action==='ban'){
        setMessage(t('emptyBanAwaitLockCue'));
      }else{
        setMessage(t('captureWaitingForStableHero'));
      }
    }catch(error){
      if(mounted.current) setMessage(error instanceof Error?error.message:'Capture failed');
    }finally{
      busyRef.current=false;
      if(mounted.current) setBusy(false);
    }
  },[captureSlotLabel,disabled,label,nextOpponentPickProbe,phase,phaseKey,pickToBanBoundary,recognizeWindowRegion,state.committedGameId,state.recognitionAutoAccept,state.recognitionThreshold,send,t,target,turnTargets,useHighlightRelease,zh]);

  useEffect(()=>{
    if(!autoWatch||result||disabled||!phase||state.committedGameId||busy||!videoReady) return;
    // Fast BP can expose a lock cue for well under a second. 250 ms keeps two
    // independent confirmation scans possible without overlapping requests;
    // busyRef still guarantees only one recognition job runs at a time.
    const timer=setTimeout(()=>{void capture();},250);
    return()=>clearTimeout(timer);
  },[autoWatch,busy,capture,disabled,phase,result,state.committedGameId,videoReady]);

  const pointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!calibratingSlot||!videoReady) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current=pointInElement(event);
  };

  const pointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!calibratingSlot||!dragStart.current) return;
    const next=regionFromDrag(dragStart.current,pointInElement(event));
    setSlots(previous=>({...previous,[calibratingSlot]:next}));
  };

  const pointerUp=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!calibratingSlot||!dragStart.current) return;
    const next=regionFromDrag(dragStart.current,pointInElement(event));
    dragStart.current=null;
    persistCalibrationSlot(calibratingSlot,next);
    setMessage(t('captureExplicitSlotSaved',{slot:captureSlotLabel(calibratingSlot)}));
    if(!precisionMode) setCalibratingSlot(undefined);
  };

  const closeReview=()=>{
    if(dialog.current?.open) dialog.current.close();
    setResult(undefined);
  };

  const openManualCandidateReview=()=>{
    if(!manualResult||!phase||disabled) return;
    if(manualResult.kind==='pick-group'){
      setGroupSelected(Object.fromEntries(manualResult.entries.flatMap(entry=>{
        const top=entry.candidates[0];
        return top?[[entry.key,top.heroId]]:[];
      })));
    }else if(manualResult.kind==='hero'){
      const top=manualResult.candidates[0];
      if(top) setSelected(top.heroId);
    }
    setResult({...manualResult,at:Date.now()});
    setMessage(t('captureManualCandidateOpened'));
  };

  const submitReview=()=>{
    if(!phase||disabled||!result) return;
    if(Date.now()-result.at>30000){
      closeReview();
      setMessage(zh?'结果已过期，请重新读取。':'Result expired. Capture again.');
      return;
    }
    if(result.kind==='pick-group'){
      const heroIds=result.entries.map(entry=>groupSelected[entry.key]??entry.candidates[0]?.heroId);
      if(heroIds.some(heroId=>heroId===undefined)){
        setMessage(zh?'同时选人结果不完整，请继续扫描。':'The simultaneous pick result is incomplete; keep scanning.');
        return;
      }
      closeReview();
      send({type:'draft_pick_group',team:result.team,heroIds:heroIds as number[]});
      return;
    }
    closeReview();
    if(result.kind==='empty-ban') send({type:'skip_ban',team:phase.team});
    else send({type:'draft_action',heroId:selected,team:phase.team,action:phase.action});
  };

  const currentSlotText=phase?.action==='pick'&&turnTargets.length>1
    ? `${t(phase.team==='blue'?'blueSide':'redSide')} · ${t('pickAction')} · ${turnTargets.map(item=>`P${item.slotIndex+1}`).join(' + ')}`
    : target
      ? t('captureCurrentSlot',{
        side:t(target.side==='blue'?'blueSide':'redSide'),
        action:t(target.action==='ban'?'banAction':'pickAction'),
        current:target.slotIndex+1,
        total:target.slotCount,
      })
      : t('draftComplete');

  const renderSlotButtons=(side:'blue'|'red',action:'ban'|'pick')=>{
    const count=action==='ban'?4:5;
    return <div className={`explicit-slot-group ${side} ${action}`}>
      <strong>{t(side==='blue'?'blueSide':'redSide')} · {t(action==='ban'?'banAction':'pickAction')}</strong>
      <div className="explicit-slot-buttons">{Array.from({length:count},(_,index)=>{
        const key=`${side}${action==='ban'?'Ban':'Pick'}${index+1}` as CaptureSlotKey;
        return <button
          type="button"
          key={key}
          disabled={!videoReady}
          className={[
            calibratingSlot===key?'selected':'',
            activeTargetKeys.has(key)?'active':'',
          ].filter(Boolean).join(' ')}
          onClick={()=>calibratingSlot===key&&!precisionMode?setCalibratingSlot(undefined):selectCalibrationSlot(key)}
        >{action==='ban'?'B':'P'}{index+1}</button>;
      })}</div>
    </div>;
  };

  return <section className="panel screen-input">
    <div className="screen-input-heading">
      <div>
        <h2>{zh?'自动 BP · 屏幕识别':'Auto BP · screen recognition'}</h2>
        <p>{t('captureLiveWorkspaceHint')}</p>
      </div>
      <div className="window-capture-toolbar">
        <button type="button" className="primary" disabled={disabled} onClick={()=>void connectWindow()}>{videoReady?t('windowCaptureChange'):t('windowCaptureChoose')}</button>
        {videoReady&&<button type="button" onClick={stopWindowCapture}>{t('windowCaptureDisconnect')}</button>}
        <span className={videoReady?'window-capture-status connected':'window-capture-status'}>{videoReady?'●':'○'} {windowInfo?.label||t('windowCaptureDisconnected')}</span>
      </div>
    </div>

    <div className="screen-input-live-grid">
      <div className="screen-input-preview-pane">
        <div ref={precisionWorkspace} className={`precision-calibration-workspace ${precisionMode?'active':''}`}>
          {precisionMode&&<div className="precision-calibration-toolbar">
            <div className="precision-calibration-title">
              <span>{t('precisionCalibrationTitle')}</span>
              <strong>{calibratingSlot?captureSlotLabel(calibratingSlot):t('captureNoActiveSlot')}</strong>
            </div>
            <div className="precision-zoom-controls" role="group" aria-label={t('precisionZoom')}>
              <button type="button" onClick={()=>setCalibrationZoom(value=>Math.max(1,Math.round((value-.25)*100)/100))}>−</button>
              <button type="button" onClick={()=>setCalibrationZoom(1)}>{t('precisionFit')}</button>
              {[1.5,2,3,4].map(value=><button type="button" key={value} className={calibrationZoom===value?'selected':''} onClick={()=>setCalibrationZoom(value)}>{Math.round(value*100)}%</button>)}
              <button type="button" onClick={()=>setCalibrationZoom(value=>Math.min(4,Math.round((value+.25)*100)/100))}>+</button>
            </div>
            <div className="precision-calibration-nav">
              <button type="button" onClick={()=>moveCalibrationSelection(-1)}>← {t('precisionPreviousSlot')}</button>
              <button type="button" className="primary" onClick={()=>moveCalibrationSelection(1)}>{t('precisionNextSlot')} →</button>
              <button type="button" onClick={()=>void exitPrecisionCalibration()}>{t('precisionExit')}</button>
            </div>
          </div>}

          <div className="precision-preview-scroll">
            <div
              className={`window-capture-preview ${videoReady?'ready':''} ${calibratingSlot?'calibrating':''}`}
              style={{
                ...(videoReady&&windowInfo?.width&&windowInfo?.height?{aspectRatio:`${windowInfo.width}/${windowInfo.height}`}:{}),
                ...(precisionMode?{width:`${calibrationZoom*100}%`}:{}),
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={()=>{dragStart.current=null;}}
            >
              <video ref={videoRef} playsInline muted />
              {videoReady&&captureSlotKeys.map(key=><div
                key={key}
                className={`capture-explicit-slot ${key.startsWith('blue')?'blue':'red'} ${key.includes('Ban')?'ban':'pick'} ${activeTargetKeys.has(key)?'active':''} ${calibratingSlot===key?'editing':''}`}
                style={percentageStyle(slots[key])}
              ><span>{captureSlotLabel(key)}</span></div>)}
              {!videoReady&&<div className="window-capture-placeholder">{t('windowCaptureChooseHint')}</div>}
            </div>
          </div>

          {precisionMode&&<div className="precision-calibration-footer">
            <div className="precision-slot-strip">
              {captureSlotKeys.map(key=><button
                type="button"
                key={key}
                className={[calibratingSlot===key?'selected':'',activeTargetKeys.has(key)?'active':''].filter(Boolean).join(' ')}
                onClick={()=>selectCalibrationSlot(key)}
              >{captureSlotLabel(key)}</button>)}
            </div>
            <div className="precision-calibration-help">
              <span>{t('precisionKeyboardHint')}</span>
              {calibrationPreview&&<figure className="precision-crop-preview">
                <figcaption>{t('precisionActualInput')}</figcaption>
                <img src={calibrationPreview} alt={t('precisionActualInput')} />
              </figure>}
            </div>
          </div>}
        </div>
        <p className="screen-input-source-meta muted">{videoReady&&windowInfo?`${windowInfo.width}×${windowInfo.height} · ${windowInfo.surface} · ${t('windowCaptureRelativeHint')}`:t('windowCaptureRelativeHint')}</p>
      </div>

      <aside className="screen-input-operator-pane">
        <div className="capture-live-status">
          <div><span>{t('capturePhaseLabel')}</span><strong>{phaseName(state)}</strong></div>
          <div><span>{t('captureSlotLabel')}</span><strong>{currentSlotText}</strong></div>
          <div><span>{t('captureCandidateLabel')}</span><strong>{candidateStatus||t('captureWaiting')}</strong></div>
          <div><span>{t('captureEmptyBanLabel')}</span><strong>{
            phase?.action!=='ban'
              ? t('captureNotApplicable')
              : emptyPromptedPhase.current===phaseKey
                ? t('capturePromptedOnce')
                : t('captureGraceThenCheck',{seconds:Math.max(0,Math.ceil((EMPTY_BAN_GRACE_MS-(Date.now()-phaseStartedAt.current))/1000))})
          }</strong></div>
        </div>

        <div className="screen-input-actions">
          <button className="primary capture-now-button" disabled={disabled||busy||!phase||!!state.committedGameId||!videoReady} onClick={()=>void capture()}>{busy?(zh?'正在识别…':'Recognizing…'):t('captureNow')}</button>
          <button
            className="manual-candidate-button"
            disabled={disabled||busy||!phase||!!state.committedGameId||!manualResult}
            onClick={openManualCandidateReview}
            title={t('captureManualCandidateHint')}
          >{t('captureManualCandidate')}</button>
          {phase?.action==='ban'
            ? <button className="empty-ban-button" disabled={disabled||!!state.committedGameId} onClick={()=>send({type:'skip_ban',team:phase.team})}>{t('emptyBanButton')}</button>
            : <span className="empty-ban-action-placeholder" aria-hidden="true" />}
          <label className="auto-watch-toggle"><input type="checkbox" checked={autoWatch} onChange={event=>{
            setAutoWatch(event.target.checked);
            localStorage.setItem('hok-capture-auto-watch',event.target.checked?'1':'0');
          }}/>{t('autoCaptureWatch')}</label>
        </div>

        <div className="screen-input-message" role="status" aria-live="polite">
          <span>{busy?t('captureRefreshing'):t('captureStatusLabel')}</span>
          <p>{message||t('captureWaitingForFrame')}</p>
        </div>
      </aside>
    </div>

    <details className="capture-calibration-tools">
      <summary>
        <span>{t('captureCalibrationToolsTitle')}</span>
        <small>{t('captureCalibrationToolsHint')}</small>
      </summary>
      <div className="explicit-slot-calibration">
        <div className="explicit-slot-calibration-heading">
          <div>
            <strong>{t('captureCalibrateExplicitSlots')}</strong>
            <p className="muted">{calibratingSlot?t('captureDragSelectedSlot',{slot:captureSlotLabel(calibratingSlot)}):t('captureExplicitCalibrationHint')}</p>
          </div>
          <div className="explicit-slot-calibration-actions">
            <button type="button" className="primary" disabled={!videoReady} onClick={()=>void enterPrecisionCalibration()}>{t('precisionOpenFullscreen')}</button>
            <button type="button" disabled={!videoReady} onClick={()=>{
              const next=normalizeCaptureSlots(defaultCaptureSlots);
              setSlots(next);
              localStorage.setItem(SLOTS_STORAGE,JSON.stringify(next));
              window.dispatchEvent(new Event('hok-capture-slots-changed'));
              setCalibratingSlot(undefined);
              setCalibrationPreview('');
              setMessage(t('captureExplicitSlotsReset'));
            }}>{t('captureResetAllSlots')}</button>
          </div>
        </div>

        <div className="explicit-slot-groups">
          {renderSlotButtons('blue','ban')}
          {renderSlotButtons('red','ban')}
          {renderSlotButtons('blue','pick')}
          {renderSlotButtons('red','pick')}
        </div>

        <details className="capture-preset-details">
          <summary>
            <span>{t('capturePresetTitle')}</span>
            <small>{selectedCapturePreset?t('capturePresetSelected',{name:selectedCapturePreset.name}):t('capturePresetCollapsedHint')}</small>
          </summary>
          <div className="capture-preset-manager">
            <div className="capture-preset-heading">
              <div>
                <strong>{t('capturePresetTitle')}</strong>
                <p className="muted">{t('capturePresetHint')}</p>
              </div>
              {selectedCapturePreset&&<span className="capture-preset-meta">
                {selectedCapturePreset.sourceWidth&&selectedCapturePreset.sourceHeight
                  ? `${selectedCapturePreset.sourceWidth}×${selectedCapturePreset.sourceHeight}`
                  : t('capturePresetRelative')}
              </span>}
            </div>
            <div className="capture-preset-controls">
              <label>
                <span>{t('capturePresetName')}</span>
                <input
                  type="text"
                  maxLength={48}
                  value={capturePresetName}
                  placeholder={t('capturePresetNamePlaceholder')}
                  onChange={event=>setCapturePresetName(event.target.value)}
                />
              </label>
              <button type="button" onClick={saveCapturePreset}>{t('capturePresetSaveNew')}</button>
              <label>
                <span>{t('capturePresetSavedList')}</span>
                <select
                  value={selectedCapturePresetId}
                  onChange={event=>{
                    const id=event.target.value;
                    setSelectedCapturePresetId(id);
                    const preset=capturePresets.find(item=>item.id===id);
                    setCapturePresetName(preset?.name??'');
                  }}
                >
                  <option value="">{t('capturePresetChoose')}</option>
                  {capturePresets.map(preset=><option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </label>
              <button type="button" className="primary" disabled={!selectedCapturePreset} onClick={loadSelectedCapturePreset}>{t('capturePresetLoad')}</button>
              <button type="button" disabled={!selectedCapturePreset} onClick={updateSelectedCapturePreset}>{t('capturePresetOverwrite')}</button>
              <button type="button" className="danger" disabled={!selectedCapturePreset} onClick={deleteSelectedCapturePreset}>{t('capturePresetDelete')}</button>
            </div>
          </div>
        </details>
      </div>
    </details>

    {result&&<dialog ref={dialog} className="library-dialog capture-review" aria-label={result.kind==='empty-ban'?t('emptyBanReviewTitle'):(zh?'确认识别结果':'Review recognition')} onCancel={event=>{event.preventDefault();closeReview();}}>
      {result.kind==='empty-ban'?<>
        <h2>{t('emptyBanReviewTitle')}</h2>
        <p>{t('emptyBanReviewHintOnce')}</p>
        <p>{currentSlotText}</p>
        <img src={result.preview} alt={zh?'当前槽位截图':'Current slot capture'}/>
      </>:result.kind==='pick-group'?<>
        <h2>{zh?(result.entries.length>1?'确认同时选人结果':'确认 Pick 结果'):(result.entries.length>1?'Review simultaneous picks':'Review pick')}</h2>
        <p>{zh?'普通 Pick 只在检测到对手下一个 Pick 位真正出现预选英雄后视为锁定；轮次边界和最后一手则检测选角高亮恢复到正常亮度。':'Normal Picks lock only after the opponent next Pick slot visibly starts preselecting; round boundaries and the final pick use the active-row highlight returning to normal.'}</p>
        <div className="pick-group-review">
          {result.entries.map(entry=><div className="pick-group-review-entry" key={entry.key}>
            <strong>{captureSlotLabel(entry.key)}</strong>
            <label>{zh?'候选英雄':'Candidate'}
              <select
                value={groupSelected[entry.key]??entry.candidates[0]?.heroId??''}
                onChange={event=>setGroupSelected(current=>({...current,[entry.key]:Number(event.target.value)}))}
              >
                {entry.candidates.map(candidate=><option key={candidate.heroId} value={candidate.heroId}>{label(candidate.heroId)} · {Math.round(candidate.confidence*100)}%</option>)}
              </select>
            </label>
            <img src={entry.preview} alt={captureSlotLabel(entry.key)}/>
          </div>)}
        </div>
      </>:<>
        <h2>{zh?'识别到：':'Recognized: '}{label(selected)}</h2>
        <label>{zh?'候选英雄（相似度，不代表准确率）':'Candidates (similarity, not accuracy)'}<select value={selected} onChange={event=>setSelected(Number(event.target.value))}>{result.candidates.map(candidate=><option key={candidate.heroId} value={candidate.heroId}>{label(candidate.heroId)} · {Math.round(candidate.confidence*100)}%</option>)}</select></label>
        <p>{currentSlotText}</p>
        <img src={result.preview} alt={zh?'当前槽位截图':'Current slot capture'}/>
      </>}
      <div className="capture-review-actions">
        <button disabled={disabled||!phase} onClick={submitReview}>{result.kind==='empty-ban'?t('emptyBanConfirm'):(zh?'确认并提交':'Confirm and submit')}</button>
        <button onClick={closeReview}>{zh?'拒绝 / 继续监视':'Reject / keep watching'}</button>
      </div>
    </dialog>}
  </section>;
}
