import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSharedBpWindow, getSharedWindowCaptureStream, subscribeSharedWindowCapture } from './sharedWindowCapture';
import { fullGameRect, pixelRect, settlementTabRects } from '../shared/gameCapture';
import { beginSharedGameStillLoad, getSharedGameStill, isCurrentSharedGameStillLoad, publishLoadedSharedGameStill, publishSharedGameStill, subscribeSharedGameStill } from './sharedGameStill';
import { getSharedCaptureContent, setSharedCaptureContent, subscribeSharedCaptureContent } from './sharedCaptureContent';
import { CaptureRegionPicker } from './CaptureRegionPicker';

export function useGameDataCapture(zh:boolean){
  const video=useRef<HTMLVideoElement|null>(null),still=useRef<HTMLImageElement|undefined>(getSharedGameStill()?.image),generation=useRef(0);
  const [videoElement,setVideoElement]=useState<HTMLVideoElement|null>(null);
  const bindVideo=useCallback((element:HTMLVideoElement|null)=>{video.current=element;setVideoElement(element);},[]);
  const [sourceVersion,setSourceVersion]=useState(0);
  const [stream,setStream]=useState(getSharedWindowCaptureStream);
  const [ready,setReady]=useState(!!getSharedGameStill()),[error,setError]=useState(''),[fileName,setFileName]=useState(()=>getSharedGameStill()?.name??'');
  const [contentPreview,setContentPreview]=useState(''),[connecting,setConnecting]=useState(false);
  const selection=useRef<AbortController>(),loading=useRef(0),mounted=useRef(false);
  useEffect(()=>{
    let active=true;mounted.current=true;
    let dimensions='',attachment=0;
    const invalidate=(clearPreview=false)=>{generation.current++;setSourceVersion(generation.current);if(clearPreview)setContentPreview('');};
    const attach=async(stream:MediaStream|undefined)=>{
      const version=++attachment;if(stream)loading.current++;
      setStream(stream);
      // The uploaded image remains the active source when an unused BP stream
      // disconnects. Keep its crop, preview and calibration intact.
      if(!still.current)invalidate(true);dimensions='';setReady(!!still.current);
      if(!video.current)return;
      video.current.srcObject=stream??null;
      if(stream)try{await video.current.play();if(active&&version===attachment&&video.current?.srcObject===stream)setReady(!!still.current||!!(video.current.videoWidth&&video.current.videoHeight));}catch{/* disconnected source */}
    };
    const element=videoElement;
    const resize=()=>{
      if(!active||still.current||!element)return;
      const next=`${element.videoWidth}:${element.videoHeight}`;
      if(dimensions&&next!==dimensions)invalidate(true);
      dimensions=next;
    };
    element?.addEventListener('resize',resize);
    void attach(getSharedWindowCaptureStream());
    const unsubscribe=subscribeSharedWindowCapture(stream=>void attach(stream));
    const unsubscribeStill=subscribeSharedGameStill(data=>{
      if(!active)return;
      loading.current++;
      still.current=data?.image;setFileName(data?.name??'');setError('');
      invalidate(true);
      const stream=getSharedWindowCaptureStream();
      setReady(!!data||!!(video.current?.videoWidth&&stream?.getVideoTracks().some(track=>track.readyState==='live')));
    });
    const unsubscribeContent=subscribeSharedCaptureContent(()=>invalidate());
    const sourceGeneration=generation,sourceLoading=loading;
    return()=>{active=false;mounted.current=false;attachment++;sourceGeneration.current++;sourceLoading.current++;selection.current?.abort();selection.current=undefined;unsubscribe();unsubscribeStill();unsubscribeContent();element?.removeEventListener('resize',resize);if(element)element.srcObject=null;};
  },[videoElement]);
  function rawFrame(){
    const source=still.current??video.current;
    if(!source)throw new Error(zh?'请先连接 BP 窗口或载入截图。':'Connect the BP window or load a screenshot first.');
    if(source instanceof HTMLVideoElement&&(!(source.srcObject instanceof MediaStream)||!source.srcObject.getVideoTracks().some(track=>track.readyState==='live')))throw new Error('Capture ended; choose the game window again');
    const width=source instanceof HTMLVideoElement?source.videoWidth:source.naturalWidth,height=source instanceof HTMLVideoElement?source.videoHeight:source.naturalHeight;
    if(!width||!height)throw new Error('Capture source unavailable');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    canvas.getContext('2d')!.drawImage(source,0,0);return canvas;
  }
  function frame(){
    const source=rawFrame(),region=getSharedCaptureContent()??fullGameRect,bounds=pixelRect(region,source.width,source.height);
    if(Math.abs(bounds.width/bounds.height-16/9)>.025)throw new Error(zh?'请展开「框选游戏内容」，在原始画面上框出 16:9 游戏区域。':'Draw the 16:9 game area under Select game content.');
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
    canvas.getContext('2d')!.drawImage(source,bounds.left,bounds.top,bounds.width,bounds.height,0,0,1920,1080);
    return canvas;
  }
  async function reuseBpWindow(){
    if(selection.current)return;
    const controller=new AbortController();selection.current=controller;setConnecting(true);loading.current++;
    try{setError('');await connectSharedBpWindow(false,controller.signal);if(mounted.current&&!controller.signal.aborted)publishSharedGameStill(undefined);}
    catch(e){if(mounted.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Capture failed');}
    finally{if(selection.current===controller){selection.current=undefined;if(mounted.current)setConnecting(false);}}
  }
  async function load(file:File|undefined){
    if(!file)return;
    selection.current?.abort();selection.current=undefined;setConnecting(false);
    const version=++generation.current,load=++loading.current,sharedVersion=beginSharedGameStillLoad();
    try{
      if(file.size>10*1024*1024)throw new Error('Screenshot too large (10 MB max)');
      const url=URL.createObjectURL(file),img=new Image();
      try{img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}
      if(img.naturalWidth*img.naturalHeight>9000000)throw new Error('Screenshot exceeds 9 million pixels');
      if(!mounted.current||load!==loading.current||version!==generation.current)return;
      if(publishLoadedSharedGameStill(sharedVersion,{image:img,name:file.name}))setError('');
    }catch(e){if(mounted.current&&load===loading.current&&version===generation.current&&isCurrentSharedGameStillLoad(sharedVersion))setError(e instanceof Error?e.message:'Invalid image');}
  }
  const controls=<div>
    <video ref={bindVideo} playsInline muted className="lineup-capture-video"/>
    <div className="toolbar"><small>{fileName?(zh?'当前使用上传截图':'Using uploaded screenshot'):stream?(zh?'默认复用 BP 窗口：':'Using BP capture: ')+(stream.getVideoTracks()[0]?.label??''):(zh?'尚未连接 BP 窗口':'BP window is not connected')}</small>
      <button type="button" disabled={connecting} onClick={()=>void reuseBpWindow()}>{stream?(zh?'使用 BP 窗口':'Use BP window'):(zh?'连接 BP 窗口（全模块共用）':'Connect BP window (shared by all modules)')}</button>
      <label>{zh?'或载入截图':'Or load screenshot'}<input aria-label="Game data screenshot" type="file" accept="image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void load(file);}}/></label>
      {fileName&&<small>{fileName}</small>}</div>
    <details><summary>{zh?'框选游戏内容（去除标题栏与黑边）':'Select game content (exclude window borders)'}</summary>
      <div className="toolbar"><button type="button" disabled={!ready} onClick={()=>{try{setContentPreview(rawFrame().toDataURL('image/jpeg',.92));setError('');}catch(e){setError(String(e));}}}>{zh?'预览原始画面并框选':'Preview raw frame and select content'}</button>
        <button type="button" onClick={()=>setSharedCaptureContent(undefined)}>{zh?'恢复完整画面':'Use full frame'}</button></div>
      {contentPreview&&<CaptureRegionPicker image={contentPreview} regions={[{id:'content',label:zh?'游戏内容':'Game content',region:getSharedCaptureContent()}]} selected="content" zh={zh} label="Game content selection" aspectRatio={16/9} onChange={setSharedCaptureContent}/>}
    </details>{error&&<p role="alert">{error}</p>}
  </div>;
  return {frame,ready,generation,sourceVersion,controls,isStill:!!fileName};
}

export function frameFingerprint(canvas:HTMLCanvasElement){
  const small=document.createElement('canvas');small.width=96;small.height=40;
  const ctx=small.getContext('2d',{willReadFrequently:true})!;
  // Exclude animated backgrounds outside the ten-player table.
  ctx.drawImage(canvas,290,210,1630,640,0,0,96,40);
  return ctx.getImageData(0,0,96,40).data;
}
export function frameDifference(a:Uint8ClampedArray,b:Uint8ClampedArray){
  let delta=0;for(let i=0;i<a.length;i+=4)delta+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
  return delta/(a.length/4*3);
}
export function framePageHint(canvas:HTMLCanvasElement){
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const scores=settlementTabRects.map(region=>{
    const r=pixelRect(region,canvas.width,canvas.height),data=ctx.getImageData(r.left,r.top,r.width,r.height).data;
    let count=0;for(let i=0;i<data.length;i+=4)if(Math.min(data[i],data[i+1],data[i+2])>170&&Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])<55)count++;
    return count;
  });
  return scores.indexOf(Math.max(...scores));
}
