import { useEffect, useRef, useState } from 'react';
import type { Action, MatchState } from '../shared/types';
import { canMergePostGameField,postGameDecimalMetrics,postGamePercentMetrics,postGameMetricLabel,postGameMetrics,type PostGameMetric,type PostGamePage,type PostGameField,type PostGameReport } from '../shared/postGame';
import { parseGoldTimelineText,timelineToText } from '../shared/postGameTimeline';
import { SettlementCapturePanel } from './SettlementCapturePanel';
import { settlementPages, settlementPageLabel } from '../shared/gameCapture';
import { regionToPixels,type NormalizedCaptureRegion } from './windowCaptureGeometry';
import { validPostGameRegion,replicateTeamFieldRegions } from './postGameRegionModel';
import { PostGameRegionPicker } from './PostGameRegionPicker';
import { useGameDataCapture } from './useGameDataCapture';
const storage='hok-post-game-regions-v1';
type Regions=Record<string,NormalizedCaptureRegion>;
function readRegions():Regions{try{const value=JSON.parse(localStorage.getItem(storage)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
interface Candidate { rowId:string; value:number|null; confidence:number; evidence:string; text:string }
function GoldTimelineEditor({report,zh,disabled,send}:{report:PostGameReport;zh:boolean;disabled:boolean;send:(action:Action)=>void}){
  const [text,setText]=useState(()=>timelineToText(report.goldTimeline??[]));
  const [message,setMessage]=useState('');
  function submit(){try{const points=parseGoldTimelineText(text);send({type:'post_game_gold_timeline',reportId:report.id,points});setMessage(zh?`已提交 ${points.length} 个回放采样点。`:`Saved ${points.length} replay samples.`);}catch(e){setMessage(e instanceof Error?e.message:String(e));}}
  return <details className="panel"><summary>{zh?'游戏进程 · 经济时间线（回放数据）':'Game progress · replay gold timeline'}</summary>
    <p className="muted">{zh?'每行填写「时间,蓝方经济,红方经济」，例如 02:00,3500,3600。支持 K、万。至少两个递增时间点，最多 240 个。仅画真实输入的点，不从结算数据推测历史。':'Enter time, blue gold, red gold per row (e.g. 02:00,3500,3600). K and 万 units accepted; 2–240 increasing samples. No history is fabricated from final totals.'}</p>
    <textarea aria-label="Replay gold timeline CSV" rows={6} style={{width:'100%',minHeight:130}} value={text} onChange={e=>setText(e.target.value)} placeholder={'02:00,3500,3600\\n05:00,11000,11200\\n10:00,24000,23700'} disabled={disabled}/>
    <div className="toolbar"><button disabled={disabled} onClick={submit}>{zh?'保存时间线':'Save timeline'}</button><span>{zh?`已保存 ${report.goldTimeline?.length??0} 个点`:`${report.goldTimeline?.length??0} saved points`}</span><a target="_blank" rel="noreferrer" href="/overlay/game-progress">{zh?'打开 1920×1080 经济进程页':'Open 1920×1080 gold progress overlay'}</a></div><p role="status">{message}</p>
  </details>;
}
export function PostGamePanel({state,token,disabled,send}:{state:MatchState;token:string;disabled:boolean;send:(action:Action)=>void}){
  const zh=state.language==='zh',report=state.postGameReports.find(r=>r.id===state.activePostGameReportId);
  const capture=useGameDataCapture(zh);
  const [metric,setMetric]=useState<PostGameMetric>('kills'),[page,setPage]=useState<PostGamePage>('overview');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[candidates,setCandidates]=useState<Candidate[]>([]);
  const [row,setRow]=useState(0),[regions,setRegions]=useState(readRegions),[snapshot,setSnapshot]=useState('');
  const requestKey=useRef('');
  requestKey.current=`${report?.id}:${metric}:${page}:${capture.sourceVersion}:${snapshot}`;
  const key=(index:number)=>`${page}:${metric}:${index}`;
  const regionFor=(index:number)=>{const saved=regions[key(index)];return validPostGameRegion(saved)?saved:undefined;};
  const fieldRegions=report?.players.map((_,index)=>regionFor(index))??[];
  useEffect(()=>{setCandidates([]);},[report?.id,metric,page]);
  useEffect(()=>{setSnapshot('');setCandidates([]);},[capture.sourceVersion]);
  const selectPage=(next:PostGamePage)=>{setPage(next);setSnapshot('');setCandidates([]);};
  function updateRegions(index:number,region:NormalizedCaptureRegion){
    const next={...regions,[key(index)]:region};
    setRegions(next);localStorage.setItem(storage,JSON.stringify(next));setCandidates([]);
  }
  function copyTeam(){
    if(!report)return;
    const result=replicateTeamFieldRegions(fieldRegions,row);
    const next={...regions};
    result.forEach((region,index)=>{if(validPostGameRegion(region))next[key(index)]=region;});
    setRegions(next);localStorage.setItem(storage,JSON.stringify(next));setCandidates([]);
  }
  function preview(){
    try{
      const frame=capture.frame();
      const check=document.createElement('canvas');check.width=64;check.height=36;
      const ctx=check.getContext('2d',{willReadFrequently:true})!;
      ctx.drawImage(frame,0,0,64,36);
      const data=ctx.getImageData(0,0,64,36).data;
      let min=255,max=0;
      for(let i=0;i<data.length;i+=4){const v=(data[i]+data[i+1]+data[i+2])/3;min=Math.min(min,v);max=Math.max(max,v);}
      if(max-min<13)throw new Error(zh?'采集到的是空白/黑屏，请重新选择正确的游戏窗口或结算截图。':'Capture was blank; choose the actual game window or screenshot.');
      setSnapshot(frame.toDataURL('image/png'));setCandidates([]);
      setMessage(zh?'画面已冻结供框选。选择选手，直接拖框数字；可复制到同队五行后检查。':'Frame frozen for calibration. Draw over one number; copy to five same-team rows if aligned.');
    }catch(e){setMessage(e instanceof Error?e.message:'Capture failed');}
  }
  async function captureFields(onlySelected:boolean){
    if(!report||!snapshot||busy)return;
    const signature=requestKey.current;setBusy(true);
    try{
      const frame=new Image();frame.src=snapshot;await frame.decode();
      const target=onlySelected?[row]:report.players.map((_,index)=>index).filter(index=>validPostGameRegion(regionFor(index)));
      if(!target.length)throw new Error(zh?'请先在截图上框选至少一个数字。':'Draw at least one number box.');
      const images:string[]=[],rowIds:string[]=[],skipped:string[]=[];
      for(const index of target){
        const roi=regionFor(index);if(!validPostGameRegion(roi))continue;
        const rect=regionToPixels(roi,frame.naturalWidth,frame.naturalHeight);
        const scale=Math.min(3,640/rect.width,128/rect.height);
        const crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(rect.width*scale));crop.height=Math.max(1,Math.round(rect.height*scale));
        const ctx=crop.getContext('2d',{willReadFrequently:true})!;
        ctx.drawImage(frame,rect.x,rect.y,rect.width,rect.height,0,0,crop.width,crop.height);
        // Never submit a solid/black numeric crop as if it contained a zero.
        const pixels=ctx.getImageData(0,0,crop.width,crop.height).data;
        let min=255,max=0;
        for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;min=Math.min(min,v);max=Math.max(max,v);}
        if(max-min<18){skipped.push(report.players[index].playerId||'P'+(index+1));continue;}
        images.push(crop.toDataURL('image/png'));rowIds.push(report.players[index].rowId);
      }
      if(!images.length)throw new Error(zh?'所选数字框都是黑色/空白。请检查画面预览和框选位置。':'Every selected region is blank. Verify the preview and redraw the boxes.');
      const api=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
      const response=await fetch(`${api}/api/v1/recognition/postgame`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({images,rowIds,reportId:report.id,metric}),signal:AbortSignal.timeout(30000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Post-game OCR failed');
      if(signature!==requestKey.current)return;
      const results=data.candidates as Candidate[];
      setCandidates(previous=>[...previous.filter(old=>!rowIds.includes(old.rowId)),...results]);
      setMessage(zh?`识别了 ${results.length} 名选手的数字候选。${skipped.length?' 空白框跳过：'+skipped.join('、'):''} 请逐项复核后应用。`:`Read ${results.length} selected player cells. ${skipped.length?'Blank cells skipped: '+skipped.join(', '):''} Review before applying.`);
    }catch(e){if(signature===requestKey.current)setMessage(e instanceof Error?e.message:'Capture failed');}
    finally{setBusy(false);}
  }
  function manualField(rowId:string,value:number){if(!report)return;send({type:'post_game_fields',reportId:report.id,updates:[{rowId,metric,field:{value,sourcePage:page,confidence:1,manual:true}}]});}
  function saveRating(rowId:string,value:string){if(!report||value.trim()==='')return;const rating=Number(value);if(!Number.isFinite(rating)||rating<0||rating>100)return;send({type:'post_game_fields',reportId:report.id,updates:[{rowId,metric:'rating',field:{value:rating,confidence:1,manual:true,sourcePage:'overview'}}]});}
  const eligible=candidates.filter(candidate=>{
    if(candidate.value===null||candidate.confidence<.85||!report)return false;
    const player=report.players.find(p=>p.rowId===candidate.rowId);
    return !!player&&canMergePostGameField(player.fields[metric],{value:candidate.value,confidence:candidate.confidence,manual:false,sourcePage:page});
  });
  return <details className="panel"><summary>{zh?'赛后数据与 MVP':'Post-game data and MVP'}</summary>
    <p className="muted">{zh?'先确认有效局。MVP 由赛事方投票决定，程序仅展示。OBS：/overlay/mvp（1920×1080）。':'Commit the game first. Organizers vote for MVP; the app only displays the result.'}</p>
    <button disabled={disabled||!state.committedGameId} onClick={()=>send({type:'post_game_begin'})}>{zh?'准备本局 10 人报告':'Prepare ten-player report'}</button>
    {report&&<><p>{zh?'第':'Game '}{report.gameNumber}{zh?'局 · 草稿':''}</p>
      <SettlementCapturePanel report={report} zh={zh} token={token} disabled={disabled} send={send}/>
      <details className="panel" open><summary>{zh?'单字段 OCR · 直接在结算截图框选数字':'Field OCR · draw boxes on the actual screenshot'}</summary>
        <p className="muted">{zh?'与「结算整页采集」共用已上传的截图。也可以选择共享窗口，然后单击预览冻结当前画面；之后无需输入坐标，直接框选每位选手的数字。':'Use the same screenshot uploaded in full-page capture, or choose a game window and freeze its current frame. Draw directly over player numbers.'}</p>
        {capture.controls}
        <div className="toolbar">
          <label>{zh?'数据页':'Data page'}<select aria-label="Post-game OCR source page" value={page} onChange={e=>selectPage(e.target.value as PostGamePage)}>{settlementPages.map(key=><option key={key} value={key}>{settlementPageLabel(key,zh)}</option>)}</select></label>
          <label>{zh?'字段':'Metric'}<select aria-label="Post-game OCR metric" value={metric} onChange={e=>setMetric(e.target.value as PostGameMetric)}>{postGameMetrics.map(key=><option key={key} value={key}>{postGameMetricLabel(key,zh)}</option>)}</select></label>
          <button type="button" disabled={!capture.ready||disabled} onClick={preview}>{zh?'预览 / 刷新当前画面':'Preview / refresh game frame'}</button>
          <small>{fieldRegions.filter(validPostGameRegion).length}/10 {zh?'人已框选':'rows selected'}</small>
        </div>
        <PostGameRegionPicker zh={zh} snapshot={snapshot} players={report.players} selected={row} onSelect={setRow} regions={fieldRegions} onRegion={updateRegions} onCopyTeam={copyTeam}/>
        <div className="toolbar">
          <button type="button" disabled={disabled||busy||!snapshot||!validPostGameRegion(regionFor(row))} onClick={()=>void captureFields(true)}>{busy?(zh?'识别中…':'Recognizing…'):(zh?'识别当前选手':'Read selected player')}</button>
          <button type="button" disabled={disabled||busy||!snapshot||!fieldRegions.some(validPostGameRegion)} onClick={()=>void captureFields(false)}>{zh?'识别所有已框选选手':'Read all selected rows'}</button>
          <button type="button" disabled={disabled||busy||!eligible.length} onClick={()=>send({type:'post_game_fields',reportId:report.id,updates:eligible.map(c=>({rowId:c.rowId,metric,field:{value:c.value!,confidence:c.confidence,manual:false,sourcePage:page,evidence:c.evidence} as PostGameField}))})}>{zh?`应用已核验候选（${eligible.length}）`:`Apply verified candidates (${eligible.length})`}</button>
        </div>
        <div className="post-game-table">{report.players.map(player=>{
          const detected=candidates.find(c=>c.rowId===player.rowId),stored=player.fields[metric];
          return <div className="toolbar" key={player.rowId}>
            <span>{player.teamName} · P{player.slot+1} · {player.playerId||'—'}</span>
            <input key={`${report.id}:${metric}:${stored?.value}`} aria-label={`${player.playerId} ${metric}`} type="number" min={0} max={postGamePercentMetrics.includes(metric)?100:1e9} step={postGameDecimalMetrics.includes(metric)?'.1':'1'} defaultValue={stored?.value??''} disabled={disabled||busy} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==stored?.value)manualField(player.rowId,Number(e.target.value));}}/>
            {stored&&<small>{stored.manual?(zh?'人工确认':'Manual'):Math.round(stored.confidence*100)+'%'}</small>}
            {detected&&<small className={detected.confidence<.85?'error':''}>{detected.value??'—'} · {Math.round(detected.confidence*100)}% {detected.value!==null&&!canMergePostGameField(stored,{value:detected.value,confidence:detected.confidence,manual:false,sourcePage:page})&&<span>{zh?'保留已有值，改动请人工输入':'Protected; edit manually'}</span>} <a href={detected.evidence} target="_blank" rel="noreferrer">{zh?'裁图':'Crop'}</a></small>}
          </div>;
        })}</div>
      </details>
      <GoldTimelineEditor key={report.id} report={report} zh={zh} disabled={disabled} send={send}/>
      <details className="panel"><summary>{zh?'选手评分 / Rating · 人工补录':'Player ratings · manual fallback'}</summary>
        <p className="muted">{zh?'先到上方「单字段 OCR」选择「游戏评分」并在截图上逐人框选，也可以在这里手动输入真实评分。未知数值留空。':'Select Rating in the field OCR above, or type confirmed scores below. Unknown ratings remain blank.'}</p>
        <div className="post-game-table">{report.players.map(player=><label className="toolbar" key={player.rowId}>{player.teamName} · {player.playerId||`P${player.slot+1}`}
          <input aria-label={`Rating ${player.rowId}`} type="number" min="0" max="100" step="0.1" key={`${player.rowId}:${player.fields.rating?.value}`} defaultValue={player.fields.rating?.value??''} placeholder="—" disabled={disabled} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==player.fields.rating?.value)saveRating(player.rowId,e.target.value);}}/>
        </label>)}</div>
      </details>
      <details className="panel"><summary>{zh?'OBS 赛后图形 · 1920×1080':'OBS post-game graphics · 1920×1080'}</summary>
        <div className="toolbar"><a href="/overlay/mvp" target="_blank" rel="noreferrer">MVP 1920×1080</a><a href="/overlay/game-progress" target="_blank" rel="noreferrer">{zh?'经济进程':'Gold progress'}</a>
          {(['clash','jungle','mid','farm','roam'] as const).map(role=><a key={role} href={`/overlay/postgame-compare?role=${role}`} target="_blank" rel="noreferrer">{role} VS</a>)}</div>
      </details>
      <label>{zh?'投票决定的 MVP':'MVP chosen by the vote'}<select aria-label="MVP player" value={report.selectedMvpRowId??''} disabled={disabled} onChange={e=>send({type:'select_mvp',reportId:report.id,rowId:e.target.value||null})}><option value="">{zh?'尚未选择 / 隐藏页面':'Not selected / hide overlay'}</option>{report.players.map(player=><option value={player.rowId} key={player.rowId}>{player.teamName} · {player.playerId||`P${player.slot+1}`}</option>)}</select></label>
    </>}
    <p role="status">{message}</p>
  </details>;
}
