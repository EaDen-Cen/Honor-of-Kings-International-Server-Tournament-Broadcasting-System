import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { validCaptureRect, type CaptureRect } from '../shared/gameCapture';
import { drawCaptureRect, moveCaptureRect, resizeCaptureRect, type CapturePoint } from './captureRegionEditor';
import './captureRegionPicker.css';

interface Region { id:string;label:string;region?:CaptureRect }
interface Drag { mode:string;start:CapturePoint;initial?:CaptureRect;pointerId:number }
export function CaptureRegionPicker({image,regions,selected,onChange,zh,label,aspectRatio,disabled=false}:{
  image:string;regions:Region[];selected:string;onChange:(region:CaptureRect)=>void;zh:boolean;label:string;aspectRatio?:number;disabled?:boolean;
}){
  const [size,setSize]=useState({width:1920,height:1080}),[zoom,setZoom]=useState(1),[draft,setDraft]=useState<CaptureRect>();
  const drag=useRef<Drag>();
  useEffect(()=>{drag.current=undefined;setDraft(undefined);},[selected,image,disabled]);
  const point=(e:PointerEvent<HTMLDivElement>)=>{const b=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};};
  const next=(end:CapturePoint)=>{
    const current=drag.current!;
    const aspect=aspectRatio?aspectRatio*size.height/size.width:undefined;
    if(current.mode==='move'&&current.initial)return moveCaptureRect(current.initial,end.x-current.start.x,end.y-current.start.y);
    if(current.mode!=='draw'&&current.initial)return resizeCaptureRect(current.initial,current.mode,end,aspect);
    return drawCaptureRect(current.start,end,aspect);
  };
  function finish(e:PointerEvent<HTMLDivElement>){
    if(!drag.current||drag.current.pointerId!==e.pointerId)return;
    const region=next(point(e));drag.current=undefined;setDraft(undefined);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(!disabled&&validCaptureRect(region)&&region.width*size.width>=2&&region.height*size.height>=2)onChange(region);
  }
  return <section className="capture-region-editor">
    <div className="toolbar"><span>{zh?'在画面上拖动框选；拖动已有选框可移动，拖四角可缩放。':'Drag to draw; move an existing box or resize its corners.'}</span><label>{zh?'预览缩放':'Preview zoom'}<select aria-label={`${label} zoom`} value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[1,1.5,2,3].map(value=><option key={value} value={value}>{value*100}%</option>)}</select></label></div>
    <div className="capture-region-scroll"><div className="capture-region-frame" aria-label={label} style={{width:`${zoom*100}%`}}
      onPointerDown={e=>{
        if(disabled||e.button!==0)return;
        e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
        const target=e.target as HTMLElement,mode=target.closest<HTMLElement>('[data-region-mode]')?.dataset.regionMode??'draw';
        drag.current={mode,start:point(e),initial:regions.find(r=>r.id===selected)?.region,pointerId:e.pointerId};
        setDraft(next(point(e)));
      }} onPointerMove={e=>{if(drag.current?.pointerId===e.pointerId)setDraft(next(point(e)));}} onPointerUp={finish}
      onPointerCancel={()=>{drag.current=undefined;setDraft(undefined);}} onLostPointerCapture={()=>{drag.current=undefined;setDraft(undefined);}}>
      <img src={image} draggable={false} alt={label} onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/>
      {regions.map(item=>{
        const region=item.id===selected&&draft?draft:item.region;
        if(!region||!validCaptureRect(region))return null;
        const active=item.id===selected;
        return <div key={item.id} className={`capture-region-outline ${active?'selected':''}`} data-region-mode={active?'move':undefined}
          style={{left:`${region.x*100}%`,top:`${region.y*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`}}>
          <b>{item.label}</b>{active&&!disabled&&['nw','ne','sw','se'].map(corner=><span key={corner} className={`capture-region-handle ${corner}`} data-region-mode={corner}/>)}
        </div>;
      })}
    </div></div>
  </section>;
}
