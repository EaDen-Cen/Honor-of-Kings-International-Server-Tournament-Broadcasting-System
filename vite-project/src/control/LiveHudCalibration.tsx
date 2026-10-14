import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { liveCaptureKeys, liveCaptureLabel, validLiveCaptureRects, type CaptureRect, type LiveCaptureKey } from '../shared/gameCapture';

type Rects=Record<LiveCaptureKey,CaptureRect>;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
/** A deliberately manual, operator-approved ROI workflow. No automatic OCR publish before calibration. */
export function LiveHudCalibration({
  zh,regions,onRegionsChange,selected,onSelectedChange,preview,onPreview,ready,onConfirm,calibrated,
}:{
  zh:boolean;regions:Rects;onRegionsChange:(value:Rects)=>void;selected:LiveCaptureKey;
  onSelectedChange:(value:LiveCaptureKey)=>void;preview:string;onPreview:()=>void;
  ready:boolean;onConfirm:()=>void;calibrated:boolean;
}){
  const [drag,setDrag]=useState<{x:number;y:number}|null>(null);
  const [end,setEnd]=useState<{x:number;y:number}|null>(null);
  function point(e:ReactPointerEvent<HTMLDivElement>){
    const bounds=e.currentTarget.getBoundingClientRect();
    return {x:clamp((e.clientX-bounds.left)/bounds.width),y:clamp((e.clientY-bounds.top)/bounds.height)};
  }
  function commit(e:ReactPointerEvent<HTMLDivElement>){
    if(!drag)return;
    const last=point(e);e.currentTarget.releasePointerCapture(e.pointerId);
    const r={x:Math.min(last.x,drag.x),y:Math.min(last.y,drag.y),width:Math.abs(last.x-drag.x),height:Math.abs(last.y-drag.y)};
    setDrag(null);setEnd(null);
    if(r.width<.005||r.height<.008)return;
    onRegionsChange({...regions,[selected]:r});
  }
  const rect=regions[selected];
  return <details className="ghud-calibration">
    <summary>{zh?'GHUD 七字段位置校准（采集源变化后须重新确认）':'Calibrate the seven HUD digits (confirm for each source)'}</summary>
    <p className="muted">{zh?'先预览真实游戏画面，再选择字段并拖框，只包围数字本身；不要包含装饰图标或两队文字。已有的固定坐标只是示例，未经验证不可自动应用。':'Preview the actual game content and draw tight rectangles around the seven digits. Stock coordinates are examples only.'}</p>
    <div className="toolbar">
      <button type="button" disabled={!ready} onClick={onPreview}>{zh?'预览当前帧':'Preview captured frame'}</button>
      <label>{zh?'选择字段':'Field'}<select value={selected} onChange={e=>onSelectedChange(e.target.value as LiveCaptureKey)}>{liveCaptureKeys.map(key=><option key={key} value={key}>{liveCaptureLabel(key,zh)}</option>)}</select></label>
      <button type="button" onClick={onConfirm} disabled={!preview||!validLiveCaptureRects(regions)}>{zh?'保存选框并确认可采样':'Save & confirm calibration'}</button>
      <strong style={{color:calibrated?'#89ecc8':'#ffcb83'}}>{calibrated?(zh?'已确认，可以采样':'Confirmed'):(zh?'未确认 · 禁止自动发布':'Not approved · no auto output')}</strong>
    </div>
    {preview&&<div className="ghud-roi-preview" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setDrag(point(e));setEnd(point(e));}}
      onPointerMove={e=>{if(drag)setEnd(point(e));}} onPointerUp={commit} onPointerCancel={()=>{setDrag(null);setEnd(null);}}>
      <img src={preview} draggable={false} alt={zh?'真实采集帧预览':'Actual source frame preview'}/>
      {liveCaptureKeys.map(key=>{
        const r=key===selected&&drag&&end?{x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),width:Math.abs(drag.x-end.x),height:Math.abs(drag.y-end.y)}:regions[key];
        return <div key={key} className={'ghud-roi '+(key===selected?'selected':'')} style={{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`}}><b>{liveCaptureLabel(key,zh)}</b></div>;
      })}
    </div>}
    <div className="ghud-roi-coordinates">
      {(['x','y','width','height'] as const).map((axis)=><label key={axis}>{axis.toUpperCase()} · px <input type="number" min={0} max={axis==='x'||axis==='width'?1920:1080} value={Math.round(rect[axis]*(axis==='x'||axis==='width'?1920:1080))} onChange={e=>{
        const size=axis==='x'||axis==='width'?1920:1080;
        const next={...regions,[selected]:{...rect,[axis]:Number(e.target.value)/size}};
        onRegionsChange(next);
      }}/></label>)}
    </div>
    <p className="muted">{zh?'注意：切换游戏客户端、镜头布局、16:9 内容裁切或分辨率后，必须重新预览并确认七项字段。':'Recalibrate after changing client, capture region, HUD layout or game resolution.'}</p>
  </details>;
}
