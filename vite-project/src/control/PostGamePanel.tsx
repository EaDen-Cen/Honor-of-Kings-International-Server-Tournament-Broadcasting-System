import { useEffect, useRef, useState } from 'react';
import type { Action, MatchState } from '../shared/types';
import { portraitAssetURL } from '../shared/config';
import { canMergePostGameField,postGameDecimalMetrics,postGamePercentMetrics,postGameMetricLabel,postGameMetrics,type PostGameMetric,type PostGamePage,type PostGameField,type PostGameReport } from '../shared/postGame';
import { parseGoldTimelineText,timelineToText } from '../shared/postGameTimeline';
import { SettlementCapturePanel } from './SettlementCapturePanel';
import { pixelRect, settlementPages, settlementPageLabel } from '../shared/gameCapture';
import type { NormalizedCaptureRegion } from './windowCaptureGeometry';
import { validPostGameRegion,replicateTeamFieldRegions } from './postGameRegionModel';
import { PostGameRegionPicker } from './PostGameRegionPicker';
import { useGameDataCapture } from './useGameDataCapture';
import { ManualNumberInput } from './ManualNumberInput';
import { hasPostGameFieldUpdate } from './postGameUpdates';
import {playerRoleLabel,postGamePlayerIdentity} from '../shared/postGamePresentation';
const storage='hok-post-game-regions-v1';
type Regions=Record<string,NormalizedCaptureRegion>;
function readRegions():Regions{try{const value=JSON.parse(localStorage.getItem(storage)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
interface Candidate { rowId:string; value:number|null; resolution?:number; confidence:number; evidence:string; text:string }
function GoldTimelineEditor({report,zh,disabled,send}:{report:PostGameReport;zh:boolean;disabled:boolean;send:(action:Action)=>void}){
  const savedText=timelineToText(report.goldTimeline??[]);
  const [text,setText]=useState(savedText),[conflict,setConflict]=useState(false);
  const [message,setMessage]=useState('');
  const dirty=useRef(false),submitted=useRef<string>(),previousSaved=useRef(savedText),draft=useRef(text);
  useEffect(()=>{
    if(previousSaved.current===savedText)return;
    previousSaved.current=savedText;
    if(!dirty.current||submitted.current===savedText||draft.current===savedText){
      setText(savedText);dirty.current=false;setConflict(false);
      if(submitted.current===savedText){setMessage(zh?'时间线已保存。':'Timeline saved.');submitted.current=undefined;}
    }else setConflict(true);
  },[savedText,zh]);
  function submit(){
    if(disabled)return;
    try{
      const points=parseGoldTimelineText(text);submitted.current=timelineToText(points);
      send({type:'post_game_gold_timeline',reportId:report.id,points});
      setMessage(zh?`已提交 ${points.length} 个回放采样点，请核对已保存点数。`:`Submitted ${points.length} replay samples; check the saved count.`);
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}
  }
  return <details className="panel"><summary>{zh?'高级修正：经济曲线回放数据':'Advanced: economy curve replay data'}</summary>
    <p>{zh?'正常采集只需在上方识别游戏「对局」页，程序会获取经济优势曲线。这里仅用于没有截图时补录回放数据。':'Capture the game recap above to read its economy advantage curve. Use this fallback to enter replay totals without a screenshot.'}</p>
    <p className="muted">{zh?'每行填写「时间,蓝方经济,红方经济」，例如 02:00,3500,3600。支持 K、万。至少两个递增时间点，最多 240 个。仅画真实输入的点，不从结算数据推测历史。':'Enter time, blue gold, red gold per row (e.g. 02:00,3500,3600). K and 万 units accepted; 2–240 increasing samples. No history is fabricated from final totals.'}</p>
    <textarea aria-label="Replay gold timeline CSV" rows={6} style={{width:'100%',minHeight:130}} value={text} onChange={e=>{dirty.current=e.target.value!==savedText;draft.current=e.target.value;submitted.current=undefined;setText(e.target.value);setMessage('');}} placeholder={'02:00,3500,3600\n05:00,11000,11200\n10:00,24000,23700'} disabled={disabled}/>
    <div className="toolbar"><button disabled={disabled||text===savedText} onClick={submit}>{zh?'保存时间线':'Save timeline'}</button><button disabled={disabled||text===savedText} onClick={()=>{dirty.current=false;submitted.current=undefined;setText(savedText);setConflict(false);setMessage('');}}>{zh?'恢复已保存内容':'Reload saved timeline'}</button><span>{zh?`已保存 ${report.goldTimeline?.length??0} 个点`:`${report.goldTimeline?.length??0} saved points`}{text!==savedText?(zh?' · 有未保存修改':' · Unsaved changes'):''}</span><a target="_blank" rel="noreferrer" href="/overlay/game-progress">{zh?'打开 1920×1080 经济进程页':'Open 1920×1080 gold progress overlay'}</a></div>{conflict&&<p role="status">{zh?'服务器时间线已更新；你的未保存内容已保留，请核对后保存或恢复已保存内容。':'The saved timeline changed. Your draft is preserved; review it before saving or reload the saved timeline.'}</p>}<p role="status">{message}</p>
  </details>;
}
export function PostGamePanel({state,token,disabled,send}:{state:MatchState;token:string;disabled:boolean;send:(action:Action)=>void}){
  const zh=state.language==='zh',report=state.postGameReports.find(r=>r.id===state.activePostGameReportId);
  const capture=useGameDataCapture(zh);
  const [metric,setMetric]=useState<PostGameMetric>('kills'),[page,setPage]=useState<PostGamePage>('overview');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[candidates,setCandidates]=useState<Candidate[]>([]);
  const [row,setRow]=useState(0),[regions,setRegions]=useState(readRegions),[snapshot,setSnapshot]=useState('');
  const requestKey=useRef(''),request=useRef<AbortController>();
  requestKey.current=`${report?.id}:${metric}:${page}:${capture.sourceVersion}:${snapshot}:${JSON.stringify(regions)}:${token}`;
  const key=(index:number)=>`${page}:${metric}:${index}`;
  const regionFor=(index:number)=>{const saved=regions[key(index)];return validPostGameRegion(saved)?saved:undefined;};
  const fieldRegions=report?.players.map((_,index)=>regionFor(index))??[];
  useEffect(()=>{setCandidates([]);},[report?.id,metric,page]);
  useEffect(()=>{setSnapshot('');setCandidates([]);},[capture.sourceVersion]);
  useEffect(()=>()=>request.current?.abort(),[report?.id,metric,page,capture.sourceVersion,snapshot,regions,token]);
  const selectPage=(next:PostGamePage)=>{setPage(next);setSnapshot('');setCandidates([]);};
  function updateRegions(index:number,region:NormalizedCaptureRegion){
    const next={...regions,[key(index)]:region};
    saveRegions(next);
  }
  function saveRegions(next:Regions){
    setRegions(next);setCandidates([]);
    try{localStorage.setItem(storage,JSON.stringify(next));}
    catch{setMessage(zh?'框选已在当前页面生效，但浏览器存储不可用；刷新后需重新框选。':'Boxes work in this page, but browser storage is unavailable. Recalibrate after reloading.');}
  }
  function copyTeam(){
    if(!report)return;
    const result=replicateTeamFieldRegions(fieldRegions,row);
    const next={...regions};
    result.forEach((region,index)=>{if(validPostGameRegion(region))next[key(index)]=region;});
    saveRegions(next);
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
    if(!report||!snapshot||busy||request.current)return;
    const signature=requestKey.current,sourceVersion=capture.generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    const timeout=window.setTimeout(()=>controller.abort(),30000);
    try{
      const frame=new Image();frame.src=snapshot;await frame.decode();
      const target=onlySelected?[row]:report.players.map((_,index)=>index).filter(index=>validPostGameRegion(regionFor(index)));
      if(!target.length)throw new Error(zh?'请先在截图上框选至少一个数字。':'Draw at least one number box.');
      const images:string[]=[],rowIds:string[]=[],skipped:string[]=[];
      for(const index of target){
        const roi=regionFor(index);if(!validPostGameRegion(roi))continue;
        const rect=pixelRect(roi,frame.naturalWidth,frame.naturalHeight);
        const scale=Math.min(3,640/rect.width,128/rect.height);
        const crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(rect.width*scale));crop.height=Math.max(1,Math.round(rect.height*scale));
        const ctx=crop.getContext('2d',{willReadFrequently:true})!;
        ctx.drawImage(frame,rect.left,rect.top,rect.width,rect.height,0,0,crop.width,crop.height);
        // Never submit a solid/black numeric crop as if it contained a zero.
        const pixels=ctx.getImageData(0,0,crop.width,crop.height).data;
        let min=255,max=0;
        for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;min=Math.min(min,v);max=Math.max(max,v);}
        if(max-min<18){skipped.push(report.players[index].playerId||'P'+(index+1));continue;}
        images.push(crop.toDataURL('image/png'));rowIds.push(report.players[index].rowId);
      }
      if(!images.length)throw new Error(zh?'所选数字框都是黑色/空白。请检查画面预览和框选位置。':'Every selected region is blank. Verify the preview and redraw the boxes.');
      const api=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
      const response=await fetch(`${api}/api/v1/recognition/postgame`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({images,rowIds,reportId:report.id,metric}),signal:controller.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Post-game OCR failed');
      if(signature!==requestKey.current||sourceVersion!==capture.generation.current)return;
      const results=data.candidates as Candidate[];
      setCandidates(previous=>[...previous.filter(old=>!rowIds.includes(old.rowId)),...results]);
      setMessage(zh?`识别了 ${results.length} 名选手的数字候选。${skipped.length?' 空白框跳过：'+skipped.join('、'):''} 请逐项复核后应用。`:`Read ${results.length} selected player cells. ${skipped.length?'Blank cells skipped: '+skipped.join(', '):''} Review before applying.`);
    }catch(e){if(signature===requestKey.current)setMessage(controller.signal.aborted?(zh?'识别超时，请检查连接后重试。':'Recognition timed out. Check the connection and retry.'):e instanceof Error?e.message:'Capture failed');}
    finally{window.clearTimeout(timeout);if(request.current===controller)request.current=undefined;setBusy(false);}
  }
  function manualField(rowId:string,value:number){if(!report)return;send({type:'post_game_fields',reportId:report.id,updates:[{rowId,metric,field:{value,sourcePage:page,confidence:1,manual:true}}]});}
  function saveRating(rowId:string,value:string){if(!report||value.trim()==='')return;const rating=Number(value);if(!Number.isFinite(rating)||rating<0||rating>100)return;send({type:'post_game_fields',reportId:report.id,updates:[{rowId,metric:'rating',field:{value:rating,confidence:1,manual:true,sourcePage:'overview'}}]});}
  const eligible=candidates.filter(candidate=>{
    if(candidate.value===null||candidate.confidence<.85||!report)return false;
    const player=report.players.find(p=>p.rowId===candidate.rowId);
    return !!player&&hasPostGameFieldUpdate(player.fields[metric],{value:candidate.value,resolution:candidate.resolution,confidence:candidate.confidence,manual:false,sourcePage:page});
  });
  return <details className="panel"><summary>{zh?'赛后数据与 MVP':'Post-game data and MVP'}</summary>
    <p className="muted">{zh?'先确认有效局。MVP 由赛事方投票决定，程序仅展示。OBS：/overlay/mvp（1920×1080）。':'Commit the game first. Organizers vote for MVP; the app only displays the result.'}</p>
    <button disabled={disabled||!state.draftHistory.length} onClick={()=>send({type:'post_game_begin'})}>{zh?(state.committedGameId?'准备本局 10 人报告':'打开上一有效局报告'):(state.committedGameId?'Prepare ten-player report':'Open last committed report')}</button>
    <label>{zh?'编辑哪一局的赛后数据':'Post-game report to edit'}<select aria-label="Post-game report" value={report?.id??''} disabled={disabled||!state.draftHistory.length} onChange={e=>{if(e.target.value)send({type:'post_game_begin',gameId:e.target.value});}}><option value="">{zh?'选择已确认的比赛':'Select a committed game'}</option>{state.draftHistory.map(game=><option key={game.id} value={game.id}>{zh?`第 ${game.gameNumber} 局`:`Game ${game.gameNumber}`}</option>)}</select></label>
    {report&&report.gameNumber!==(state.draftGameNumber??state.gameNumber)&&<p role="status">{zh?`正在编辑第 ${report.gameNumber} 局，当前比赛为第 ${state.draftGameNumber??state.gameNumber} 局。请确认报告局数；第二局数据需选择第二局报告，避免覆盖第一局。`:`Editing Game ${report.gameNumber}; current game is ${state.draftGameNumber??state.gameNumber}. Select the correct report before applying data.`}</p>}
    {report&&<><p>{zh?'第':'Game '}{report.gameNumber}{zh?'局 · 草稿':''}</p>
      <SettlementCapturePanel key={report.id} report={report} zh={zh} token={token} disabled={disabled} send={send}/>
      <details className="panel"><summary>{zh?'高级修正：单字段 OCR · 框选数字':'Advanced: field OCR · draw boxes on the actual screenshot'}</summary>
        <p className="muted">{zh?'与「结算整页采集」共用已上传的截图。也可以选择共享窗口，然后单击预览冻结当前画面；之后无需输入坐标，直接框选每位选手的数字。':'Use the same screenshot uploaded in full-page capture, or choose a game window and freeze its current frame. Draw directly over player numbers.'}</p>
        {capture.controls}
        <div className="toolbar">
          <label>{zh?'数据页':'Data page'}<select aria-label="Post-game OCR source page" value={page} onChange={e=>selectPage(e.target.value as PostGamePage)}>{settlementPages.filter(key=>key!=='recap').map(key=><option key={key} value={key}>{settlementPageLabel(key,zh)}</option>)}</select></label>
          <label>{zh?'字段':'Metric'}<select aria-label="Post-game OCR metric" value={metric} onChange={e=>setMetric(e.target.value as PostGameMetric)}>{postGameMetrics.map(key=><option key={key} value={key}>{postGameMetricLabel(key,zh)}</option>)}</select></label>
          <button type="button" disabled={!capture.ready||disabled} onClick={preview}>{zh?'预览 / 刷新当前画面':'Preview / refresh game frame'}</button>
          <small>{fieldRegions.filter(validPostGameRegion).length}/10 {zh?'人已框选':'rows selected'}</small>
        </div>
        <PostGameRegionPicker zh={zh} snapshot={snapshot} players={report.players} selected={row} onSelect={setRow} regions={fieldRegions} onRegion={updateRegions} onCopyTeam={copyTeam}/>
        <div className="toolbar">
          <button type="button" disabled={disabled||busy||!snapshot||!validPostGameRegion(regionFor(row))} onClick={()=>void captureFields(true)}>{busy?(zh?'识别中…':'Recognizing…'):(zh?'识别当前选手':'Read selected player')}</button>
          <button type="button" disabled={disabled||busy||!snapshot||!fieldRegions.some(validPostGameRegion)} onClick={()=>void captureFields(false)}>{zh?'识别所有已框选选手':'Read all selected rows'}</button>
          <button type="button" disabled={disabled||busy||!eligible.length} onClick={()=>send({type:'post_game_fields',reportId:report.id,updates:eligible.map(c=>({rowId:c.rowId,metric,field:{value:c.value!,resolution:c.resolution,confidence:c.confidence,manual:false,sourcePage:page,evidence:c.evidence} as PostGameField}))})}>{zh?`应用已核验候选（${eligible.length}）`:`Apply verified candidates (${eligible.length})`}</button>
        </div>
        <p className="muted">{zh?'人工数值输完后按 Enter 或离开输入框保存；Esc 放弃当前修改。未保存的输入会保留，百分比和评分须在 0–100 之间。':'Press Enter or leave a field to save; Esc discards your edit. Drafts are preserved. Percentages and ratings must be between 0 and 100.'}</p>
        <div className="post-game-table">{report.players.map(player=>{
          const detected=candidates.find(c=>c.rowId===player.rowId),stored=player.fields[metric];
          return <div className="toolbar" key={player.rowId}>
            <span>{player.teamName} · P{player.slot+1} · {player.playerId||'—'}</span>
            <ManualNumberInput key={`${report.id}:${metric}:${player.rowId}`} label={`${player.playerId} ${metric}`} zh={zh} min={0} max={postGamePercentMetrics.includes(metric)||metric==='rating'?100:1e9} integer={!postGameDecimalMetrics.includes(metric)} value={stored?.value} disabled={disabled||busy} onCommit={value=>manualField(player.rowId,value!)}/>
            {stored&&<small>{stored.manual?(zh?'人工确认':'Manual'):Math.round(stored.confidence*100)+'%'}</small>}
            {detected&&<small className={detected.confidence<.85?'error':''}>{detected.value??'—'} · {Math.round(detected.confidence*100)}% {detected.value!==null&&!canMergePostGameField(stored,{value:detected.value,confidence:detected.confidence,manual:false,sourcePage:page})&&<span>{zh?'保留已有值，改动请人工输入':'Protected; edit manually'}</span>} <a href={portraitAssetURL(detected.evidence)} target="_blank" rel="noreferrer">{zh?'裁图':'Crop'}</a></small>}
          </div>;
        })}</div>
      </details>
      <GoldTimelineEditor key={report.id} report={report} zh={zh} disabled={disabled} send={send}/>
      <details className="panel"><summary>{zh?'选手评分 / Rating · 人工补录':'Player ratings · manual fallback'}</summary>
        <p className="muted">{zh?'仅在游戏实际提供数字评分时补录。当前结算页的 B、A、A+、S 是字母评级，在整页总览中单独识别；四位数是经济。不能将这些内容填入数字评分。':'Only enter numeric ratings actually supplied by the game. B, A, A+, S are separate letter grades captured on Summary; four-digit totals are gold.'}</p>
        <div className="post-game-table">{report.players.map(player=><label className="toolbar" key={player.rowId}>{player.teamName} · {player.playerId||`P${player.slot+1}`}
          <ManualNumberInput key={`${report.id}:${player.rowId}`} label={`Rating ${player.rowId}`} zh={zh} min={0} max={100} integer={false} value={player.fields.rating?.value} placeholder="—" disabled={disabled} onCommit={value=>saveRating(player.rowId,String(value))}/>
        </label>)}</div>
      </details>
      <details className="panel"><summary>{zh?'OBS 赛后图形 · 1920×1080':'OBS post-game graphics · 1920×1080'}</summary>
        <div className="toolbar"><a href="/overlay/mvp" target="_blank" rel="noreferrer">MVP 1920×1080</a><a href="/overlay/game-progress" target="_blank" rel="noreferrer">{zh?'经济进程':'Gold progress'}</a>
          {(['clash','jungle','mid','farm','roam'] as const).map(role=><a key={role} href={`/overlay/postgame-compare?role=${role}`} target="_blank" rel="noreferrer">{role} VS</a>)}</div>
      </details>
      <label>{zh?'赛事 / 数据 MVP（人工确认，与观众投票独立）':'Tournament / data MVP (separate from audience voting)'}<select aria-label="MVP player" value={report.selectedMvpRowId??''} disabled={disabled} onChange={e=>send({type:'select_mvp',reportId:report.id,rowId:e.target.value||null})}><option value="">{zh?'尚未选择 / 隐藏页面':'Not selected / hide overlay'}</option>{report.players.map(saved=>{const player=postGamePlayerIdentity(state,saved);return <option value={player.rowId} key={player.rowId}>{player.teamName} · {player.playerId||`P${player.slot+1}`} · {playerRoleLabel(player.role,zh)}</option>;})}</select></label>
      {report.selectedMvpRowId&&<div className="toolbar"><a href="/overlay/mvp" target="_blank" rel="noreferrer">{zh?'预览 MVP':'Preview MVP'}</a><label>{zh?'MVP 图片缩放（1× 最宽且填满）':'MVP image zoom (1× widest fill)'}<input aria-label="MVP image zoom" type="range" min="1" max="2" step="0.05" disabled={disabled} defaultValue={report.mvpArtScale??1} key={report.mvpArtScale??1} onPointerUp={e=>{const scale=Number(e.currentTarget.value);if(scale!==(report.mvpArtScale??1))send({type:'post_game_mvp_art_scale',reportId:report.id,scale});}} onKeyUp={e=>{const scale=Number(e.currentTarget.value);if(scale!==(report.mvpArtScale??1))send({type:'post_game_mvp_art_scale',reportId:report.id,scale});}}/></label><span>{zh?'位置来自选手资料，不按 P1–P5 推定；照片优先，缺失时使用横排英雄裁切。':'Role comes from the player roster, not P1–P5. Photo first; otherwise cropped hero art.'}</span></div>}
    </>}
    <p role="status">{message}</p>
  </details>;
}
