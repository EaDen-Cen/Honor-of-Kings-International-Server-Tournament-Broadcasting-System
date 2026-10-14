import { useEffect, useState, type PointerEvent as PointerEventReact } from 'react';
import type { PostGamePlayer } from '../shared/postGame';
import { normalizeCaptureRegion, regionFromDrag, regionToPixels, type NormalizedCaptureRegion } from './windowCaptureGeometry';
import { validPostGameRegion } from './postGameRegionModel';
import './postGameRegionPicker.css';
const point=(event:PointerEventReact<HTMLDivElement>)=>{
  const bounds=event.currentTarget.getBoundingClientRect();
  return {x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))};
};
export function PostGameRegionPicker({zh,snapshot,players,selected,onSelect,regions,onRegion,onCopyTeam}:{
  zh:boolean;snapshot:string;players:PostGamePlayer[];selected:number;
  onSelect:(i:number)=>void;regions:(NormalizedCaptureRegion|undefined)[];
  onRegion:(index:number,region:NormalizedCaptureRegion)=>void;onCopyTeam:()=>void;
}){
  const [zoom,setZoom]=useState(1);
  const [start,setStart]=useState<{x:number;y:number}|null>(null);
  const [end,setEnd]=useState<{x:number;y:number}|null>(null);
  const [cropPreview,setCropPreview]=useState('');
  const selectedRegion=regions[selected];
  useEffect(()=>{
    let alive=true;
    if(!snapshot||!validPostGameRegion(selectedRegion)){setCropPreview('');return;}
    const image=new Image();image.src=snapshot;
    void image.decode().then(()=>{
      if(!alive)return;
      const r=regionToPixels(selectedRegion,image.naturalWidth,image.naturalHeight);
      const canvas=document.createElement('canvas');
      const scale=Math.min(3,500/r.width,150/r.height);
      canvas.width=Math.max(1,Math.round(r.width*scale));canvas.height=Math.max(1,Math.round(r.height*scale));
      canvas.getContext('2d')?.drawImage(image,r.x,r.y,r.width,r.height,0,0,canvas.width,canvas.height);
      if(alive)setCropPreview(canvas.toDataURL('image/png'));
    }).catch(()=>{if(alive)setCropPreview('');});
    return()=>{alive=false;};
  },[snapshot,selectedRegion]);
  function finish(e:PointerEventReact<HTMLDivElement>){
    if(!start)return;
    const finish=point(e);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    const dx=Math.abs(finish.x-start.x),dy=Math.abs(finish.y-start.y);
    if(dx>=.008&&dy>=.008)onRegion(selected,regionFromDrag(start,finish));
    setStart(null);setEnd(null);
  }
  return <section className="pg-roi-editor">
    <div className="toolbar">
      <label>{zh?'选择选手，然后拖框':'Choose a player, then drag over the number'}
        <select aria-label="Post-game OCR player to crop" value={selected} onChange={e=>onSelect(Number(e.target.value))}>
          {players.map((player,index)=><option value={index} key={player.rowId}>{player.side==='blue'?(zh?'蓝':'Blue'):(zh?'红':'Red')} P{player.slot+1} · {player.playerId||'—'} {regions[index]?'✓':''}</option>)}
        </select>
      </label>
      <button type="button" disabled={!validPostGameRegion(selectedRegion)} onClick={onCopyTeam}>{zh?'按行距复制本队 5 个框':'Copy region to this team (5 rows)'}</button>
      <label>{zh?'放大框选画面':'Preview zoom'}<select aria-label="Post-game crop zoom" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label>
    </div>
    <p className="muted">{zh?'直接在下面截图上拖动黄色方框，只框选数字。蓝红两队各选 5 人；已经框好的区域会显示边框。复制行距后请检查每个框是否准确。':'Drag a box around digits only. Existing regions remain visible; review all five copied boxes.'}</p>
    {snapshot?<div className="pg-roi-scroll"><div className="pg-roi-frame" style={{width:(zoom*100)+'%',maxWidth:(1152*zoom)+'px'}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const p=point(e);setStart(p);setEnd(p);}}
      onPointerMove={e=>{if(start)setEnd(point(e));}} onPointerUp={finish} onPointerCancel={()=>{setStart(null);setEnd(null);}}>
      <img src={snapshot} alt={zh?'游戏截图：请直接框选评分数字':'Captured game screen for selecting OCR digits'} draggable={false}/>
      {regions.map((region,index)=>{
        const shown=index===selected&&start&&end?regionFromDrag(start,end):region;
        if(!validPostGameRegion(shown))return null;
        return <div className={'pg-roi-outline '+(index===selected?'current':'')} key={players[index].rowId} style={{left:shown.x*100+'%',top:shown.y*100+'%',width:shown.width*100+'%',height:shown.height*100+'%'}}><b>{index<5?'B':'R'}{index%5+1}</b></div>;
      })}
    </div></div>:<p className="notice">{zh?'先点「预览/刷新当前游戏画面」，或在上方加载结算截图。':'Preview the actual screenshot or shared game window first.'}</p>}
    <div className="pg-roi-bottom">
      <div>{zh?'选中区域预览':'Selected numeric crop'}：{cropPreview?<img className="pg-roi-crop" src={cropPreview} alt="Selected digits preview"/>:<span>{zh?'尚未框选':'No region selected'}</span>}</div>
      {validPostGameRegion(selectedRegion)&&<details><summary>{zh?'精确调整坐标（高级）':'Advanced ROI coordinates'}</summary>
        <div className="toolbar">{(['x','y','width','height'] as const).map(axis=><label key={axis}>{axis.toUpperCase()} %<input aria-label={'ROI '+axis} type="number" min={0} max={100} step={.1} value={Number((selectedRegion[axis]*100).toFixed(1))} onChange={e=>onRegion(selected,normalizeCaptureRegion({...selectedRegion,[axis]:Number(e.target.value)/100}))}/></label>)}</div>
      </details>}
    </div>
  </section>;
}
