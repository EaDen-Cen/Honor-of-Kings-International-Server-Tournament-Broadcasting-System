import { useEffect, useRef, useState } from 'react';
import { getSharedWindowCaptureStream, requestWindowCapture, setSharedWindowCaptureStream, subscribeSharedWindowCapture } from './sharedWindowCapture';
import { pixelRect, settlementTabRects } from '../shared/gameCapture';

export function useGameDataCapture(zh:boolean){
  const video=useRef<HTMLVideoElement>(null),still=useRef<HTMLImageElement>(),generation=useRef(0);
  const [sourceVersion,setSourceVersion]=useState(0);
  const [ready,setReady]=useState(false),[top,setTop]=useState(0),[error,setError]=useState(''),[fileName,setFileName]=useState('');
  const topRef=useRef(top);topRef.current=top;
  useEffect(()=>{
    let active=true;
    const attach=async(stream:MediaStream|undefined)=>{
      const version=++generation.current;setSourceVersion(version);still.current=undefined;setFileName('');setReady(false);
      if(!video.current)return;
      video.current.srcObject=stream??null;
      if(stream)try{await video.current.play();if(active&&version===generation.current)setReady(true);}catch{/* disconnected source */}
    };
    void attach(getSharedWindowCaptureStream());
    const unsubscribe=subscribeSharedWindowCapture(stream=>void attach(stream));
    const sourceGeneration=generation;
    return()=>{active=false;sourceGeneration.current++;unsubscribe();};
  },[]);
  function frame(){
    const source=still.current??video.current;
    if(!source)throw new Error('Choose game window or screenshot');
    if(source instanceof HTMLVideoElement&&(!(source.srcObject instanceof MediaStream)||!source.srcObject.getVideoTracks().some(track=>track.readyState==='live')))throw new Error('Capture ended; choose the game window again');
    const width=source instanceof HTMLVideoElement?source.videoWidth:source.naturalWidth,height=source instanceof HTMLVideoElement?source.videoHeight:source.naturalHeight;
    if(!width||!height)throw new Error('Capture source unavailable');
    const contentHeight=Math.round(width*9/16);
    // Do not guess that vertical letterboxing is all *above* the video:
    // desktop capture often includes a bottom replay toolbar; this silently
    // shifted every OCR rectangle upward and created plausible false matches.
    const offset=topRef.current<0?0:topRef.current;
    if(offset<0||offset+contentHeight>height+Math.max(4,contentHeight*.02))throw new Error('Select an exact 16:9 game content area; adjust content top or use a clean game capture');
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
    canvas.getContext('2d')!.drawImage(source,0,offset,width,Math.min(contentHeight,height-offset),0,0,1920,1080);
    return canvas;
  }
  async function choose(){try{setError('');const stream=await requestWindowCapture(),previous=getSharedWindowCaptureStream();setSharedWindowCaptureStream(stream);previous?.getTracks().forEach(track=>track.stop());}catch(e){setError(e instanceof Error?e.message:'Capture failed');}}
  async function load(file:File|undefined){
    if(!file)return;
    const version=++generation.current;
    try{
      if(file.size>10*1024*1024)throw new Error('Screenshot too large (10 MB max)');
      const url=URL.createObjectURL(file),img=new Image();
      try{img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}
      if(version!==generation.current)return;
      still.current=img;setReady(true);setFileName(file.name);setError('');
      setSourceVersion(generation.current);
    }catch(e){setError(e instanceof Error?e.message:'Invalid image');}
  }
  const controls=<div className="toolbar">
    <video ref={video} playsInline muted className="lineup-capture-video"/>
    <button type="button" onClick={()=>void choose()}>{zh?'选择共享游戏窗口':'Choose shared game window'}</button>
    <label>{zh?'或载入截图':'Or load screenshot'}<input aria-label="Game data screenshot" type="file" accept="image/png,image/jpeg" onChange={e=>void load(e.target.files?.[0])}/></label>
    <label>{zh?'内容顶部偏移 px（默认 0，手动校准）':'Content top px (default 0; calibrate)'}<input aria-label="Game content top" type="number" min={-1} max={200} value={top} onChange={e=>{generation.current++;setSourceVersion(generation.current);setTop(Number(e.target.value));}}/></label>
    {fileName&&<small>{fileName}</small>}{error&&<p role="alert">{error}</p>}
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
