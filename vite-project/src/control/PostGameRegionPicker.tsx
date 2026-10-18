import { useEffect, useState } from 'react';
import type { PostGamePlayer } from '../shared/postGame';
import type { NormalizedCaptureRegion } from './windowCaptureGeometry';
import { pixelRect } from '../shared/gameCapture';
import { CaptureRegionPicker } from './CaptureRegionPicker';
import { validPostGameRegion } from './postGameRegionModel';
import './postGameRegionPicker.css';
export function PostGameRegionPicker({zh,snapshot,players,selected,onSelect,regions,onRegion,onCopyTeam}:{
  zh:boolean;snapshot:string;players:PostGamePlayer[];selected:number;
  onSelect:(i:number)=>void;regions:(NormalizedCaptureRegion|undefined)[];
  onRegion:(index:number,region:NormalizedCaptureRegion)=>void;onCopyTeam:()=>void;
}){
  const [cropPreview,setCropPreview]=useState('');
  const selectedRegion=regions[selected];
  useEffect(()=>{
    let alive=true;
    if(!snapshot||!validPostGameRegion(selectedRegion)){setCropPreview('');return;}
    const image=new Image();image.src=snapshot;
    void image.decode().then(()=>{
      if(!alive)return;
      const r=pixelRect(selectedRegion,image.naturalWidth,image.naturalHeight);
      const canvas=document.createElement('canvas');
      const scale=Math.min(3,500/r.width,150/r.height);
      canvas.width=Math.max(1,Math.round(r.width*scale));canvas.height=Math.max(1,Math.round(r.height*scale));
      canvas.getContext('2d')?.drawImage(image,r.left,r.top,r.width,r.height,0,0,canvas.width,canvas.height);
      if(alive)setCropPreview(canvas.toDataURL('image/png'));
    }).catch(()=>{if(alive)setCropPreview('');});
    return()=>{alive=false;};
  },[snapshot,selectedRegion]);
  return <section className="pg-roi-editor">
    <div className="toolbar">
      <label>{zh?'选择选手，然后拖框':'Choose a player, then drag over the number'}
        <select aria-label="Post-game OCR player to crop" value={selected} onChange={e=>onSelect(Number(e.target.value))}>
          {players.map((player,index)=><option value={index} key={player.rowId}>{player.side==='blue'?(zh?'蓝':'Blue'):(zh?'红':'Red')} P{player.slot+1} · {player.playerId||'—'} {regions[index]?'✓':''}</option>)}
        </select>
      </label>
      <button type="button" disabled={!validPostGameRegion(selectedRegion)} onClick={onCopyTeam}>{zh?'按行距复制本队 5 个框':'Copy region to this team (5 rows)'}</button>
    </div>
    <p className="muted">{zh?'直接在下面截图上拖动黄色方框，只框选数字。蓝红两队各选 5 人；已经框好的区域会显示边框。复制行距后请检查每个框是否准确。':'Drag a box around digits only. Existing regions remain visible; review all five copied boxes.'}</p>
    {snapshot?<CaptureRegionPicker image={snapshot} selected={players[selected].rowId} zh={zh} label="Post-game digit selection"
      regions={players.map((player,index)=>({id:player.rowId,label:`${index<5?'B':'R'}${index%5+1}`,region:regions[index]}))} onChange={region=>onRegion(selected,region)}/>:<p className="notice">{zh?'先点「预览/刷新当前游戏画面」，或在上方加载结算截图。':'Preview the actual screenshot or shared game window first.'}</p>}
    <div className="pg-roi-bottom">
      <div>{zh?'选中区域预览':'Selected numeric crop'}：{cropPreview?<img className="pg-roi-crop" src={cropPreview} alt="Selected digits preview"/>:<span>{zh?'尚未框选':'No region selected'}</span>}</div>
    </div>
  </section>;
}
