import { useEffect, useRef, useState } from 'react';
import type { Action, MatchState } from '../shared/types';
import { canMergePostGameField,postGameDecimalMetrics,postGamePercentMetrics,postGameMetricLabel,postGameMetrics,type PostGameMetric,type PostGamePage,type PostGameField,type PostGameReport } from '../shared/postGame';
import { parseGoldTimelineText,timelineToText } from '../shared/postGameTimeline';
import { SettlementCapturePanel } from './SettlementCapturePanel';
import { settlementPages, settlementPageLabel } from '../shared/gameCapture';
import { getSharedWindowCaptureStream,subscribeSharedWindowCapture } from './sharedWindowCapture';
import { normalizeCaptureRegion,regionToPixels,type NormalizedCaptureRegion } from './windowCaptureGeometry';
const storage='hok-post-game-regions-v1';
type Regions=Record<string,NormalizedCaptureRegion>;
function readRegions():Regions{try{return JSON.parse(localStorage.getItem(storage)||'{}');}catch{return {};}}
interface Candidate { rowId:string; value:number|null; confidence:number; evidence:string; text:string }
function GoldTimelineEditor({report,zh,disabled,send}:{report:PostGameReport;zh:boolean;disabled:boolean;send:(action:Action)=>void}){
  const [text,setText]=useState(()=>timelineToText(report.goldTimeline??[]));
  const [message,setMessage]=useState('');
  useEffect(()=>{setText(timelineToText(report.goldTimeline??[]));setMessage('');},[report.id]);
  function submit(){try{const points=parseGoldTimelineText(text);send({type:'post_game_gold_timeline',reportId:report.id,points});setMessage(zh?`已提交 ${points.length} 个回放采样点。`:`Saved ${points.length} replay samples.`);}catch(e){setMessage(e instanceof Error?e.message:String(e));}}
  return <details className="panel"><summary>{zh?'游戏进程 · 经济时间线（回放数据）':'Game progress · replay gold timeline'}</summary>
    <p className="muted">{zh?'每行填写「时间,蓝方经济,红方经济」，例如 02:00,3500,3600。支持 K、万。至少两个递增时间点，最多 240 个。仅画真实输入的点，不从结算数据推测历史。':'Enter time, blue gold, red gold per row (e.g. 02:00,3500,3600). K and 万 units accepted; 2–240 increasing samples. No history is fabricated from final totals.'}</p>
    <textarea aria-label="Replay gold timeline CSV" rows={6} style={{width:'100%',minHeight:130}} value={text} onChange={e=>setText(e.target.value)} placeholder={'02:00,3500,3600\\n05:00,11000,11200\\n10:00,24000,23700'} disabled={disabled}/>
    <div className="toolbar"><button disabled={disabled} onClick={submit}>{zh?'保存时间线':'Save timeline'}</button><span>{zh?`已保存 ${report.goldTimeline?.length??0} 个点`:`${report.goldTimeline?.length??0} saved points`}</span><a target="_blank" rel="noreferrer" href="/overlay/game-progress">{zh?'打开 1920×1080 经济进程页':'Open 1920×1080 gold progress overlay'}</a></div><p role="status">{message}</p>
  </details>;
}
export function PostGamePanel({state,token,disabled,send}:{state:MatchState;token:string;disabled:boolean;send:(action:Action)=>void}){
  const zh=state.language==='zh',report=state.postGameReports.find(r=>r.id===state.activePostGameReportId);
  const [metric,setMetric]=useState<PostGameMetric>('kills'),[page,setPage]=useState<PostGamePage>('overview'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[candidates,setCandidates]=useState<Candidate[]>([]),[row,setRow]=useState(0),[regions,setRegions]=useState(readRegions);
  const video=useRef<HTMLVideoElement>(null),context=useRef('');
  context.current=`${report?.id}:${metric}:${page}`;
  const [ready,setReady]=useState(false);
  const key=(index:number)=>`${page}:${metric}:${index}`;
  const regionFor=(index:number)=>regions[key(index)]??{x:.45,y:.16+index*.062,width:.08,height:.025};
  useEffect(()=>{
    let active=true;
    const attach=async(stream:MediaStream|undefined)=>{if(!video.current)return;video.current.srcObject=stream??null;setReady(false);if(stream)try{await video.current.play();if(active)setReady(true);}catch{/* capture unavailable */}};
    void attach(getSharedWindowCaptureStream());const unsubscribe=subscribeSharedWindowCapture(stream=>void attach(stream));
    return()=>{active=false;unsubscribe();};
  },[]);
  useEffect(()=>{setCandidates([]);},[report?.id,metric,page]);
  async function capture(){
    if(!report||!video.current?.videoWidth)return;
    setBusy(true);const signature=context.current;
    try{
      const source=video.current,frame=document.createElement('canvas');frame.width=source.videoWidth;frame.height=source.videoHeight;frame.getContext('2d')!.drawImage(source,0,0);
      const images=report.players.map((_,index)=>{const rect=regionToPixels(regionFor(index),frame.width,frame.height),crop=document.createElement('canvas');crop.width=Math.min(640,rect.width*2);crop.height=Math.min(128,rect.height*2);crop.getContext('2d')!.drawImage(frame,rect.x,rect.y,rect.width,rect.height,0,0,crop.width,crop.height);return crop.toDataURL('image/png');});
      const api=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
      const response=await fetch(`${api}/api/v1/recognition/postgame`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({images,reportId:report.id,metric}),signal:AbortSignal.timeout(8000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      if(context.current!==signature)return;
      setCandidates(result.candidates);setMessage(zh?'候选数据已生成；检查后应用。低置信度数据不会自动进入 MVP 亮点。':'Candidates ready; review before applying. Low-confidence fields do not enter MVP highlights.');
    }catch(error){setMessage(error instanceof Error?error.message:'Capture failed');}finally{setBusy(false);}
  }
  function field(rowId:string,value:number){if(!report)return;send({type:'post_game_fields',reportId:report.id,updates:[{rowId,metric,field:{value,sourcePage:page,confidence:1,manual:true}}]});}
  const region=regionFor(row);
  const ratingPlayers=report?.players??[];
  function saveRating(rowId:string,value:string){if(!report||value.trim()==='')return;const rating=Number(value);if(!Number.isFinite(rating)||rating<0||rating>100)return;send({type:'post_game_fields',reportId:report.id,updates:[{rowId,metric:'rating',field:{value:rating,confidence:1,manual:true,sourcePage:'overview'}}]});}
  return <details className="panel"><summary>{zh?'赛后数据与 MVP':'Post-game data and MVP'}</summary>
    <video ref={video} className="lineup-capture-video" playsInline muted/>
    <p className="muted">{zh?'先确认有效局。MVP 由赛事方投票决定，程序仅展示。OBS：/overlay/mvp（1920×1080）。':'Commit the game first. Organizers vote for MVP; the app only displays the result. OBS: /overlay/mvp (1920×1080).'}</p>
    <button disabled={disabled||!state.committedGameId} onClick={()=>send({type:'post_game_begin'})}>{zh?'准备本局 10 人报告':'Prepare ten-player report'}</button>
    {report&&<><p>{zh?'第':'Game '}{report.gameNumber}{zh?'局 · 草稿':''}</p>
      <SettlementCapturePanel report={report} zh={zh} token={token} disabled={disabled} send={send}/>
      <GoldTimelineEditor key={report.id} report={report} zh={zh} disabled={disabled} send={send}/>
      <details className="panel"><summary>{zh?'选手评分 / Rating · 补录与识别':'Player rating · capture or manual entry'}</summary>
        <p className="muted">{zh?'当前整页固定模板没有可靠的评分坐标。可在下方补录回放结算评分，或选择字段「游戏评分」并校准十行数字区域进行 OCR；未核实的数据不会被虚构为 0。':'The fixed full-page template does not yet have a verified rating region. Enter confirmed replay scores here, or choose Rating in the field OCR and calibrate the ten numeric regions. Unknown ratings remain blank.'}</p>
        <div className="post-game-table">{ratingPlayers.map(player=><label className="toolbar" key={player.rowId}>{player.teamName} · {player.playerId||`P${player.slot+1}`}
          <input aria-label={`Rating ${player.rowId}`} type="number" min="0" max="100" step="0.1" key={`${player.rowId}:${player.fields.rating?.value}`} defaultValue={player.fields.rating?.value??''} placeholder="—" disabled={disabled} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==player.fields.rating?.value)saveRating(player.rowId,e.target.value);}}/>
        </label>)}</div>
        <button disabled={disabled} onClick={()=>{setPage('overview');setMetric('rating');}}>{zh?'选择评分 OCR 字段（下方校准）':'Select rating OCR field (calibrate below)'}</button>
      </details>
      <div className="toolbar"><label>{zh?'数据页':'Source page'}<select value={page} onChange={e=>setPage(e.target.value as PostGamePage)}>{settlementPages.map(key=><option key={key} value={key}>{settlementPageLabel(key,zh)}</option>)}</select></label>
        <label>{zh?'字段':'Field'}<select value={metric} onChange={e=>setMetric(e.target.value as PostGameMetric)}>{postGameMetrics.map(key=><option key={key} value={key}>{postGameMetricLabel(key,zh)}</option>)}</select></label>
        <button disabled={disabled||busy||!ready} onClick={()=>void capture()}>{busy?(zh?'识别中…':'Recognizing…'):(zh?'捕获当前页字段':'Capture current field')}</button>
        <button disabled={disabled||!candidates.some(c=>c.value!==null)} onClick={()=>send({type:'post_game_fields',reportId:report.id,updates:candidates.filter(c=>c.value!==null).map(c=>({rowId:c.rowId,metric,field:{value:c.value!,confidence:c.confidence,manual:false,sourcePage:page,evidence:c.evidence} as PostGameField}))})}>{zh?'应用候选数据':'Apply candidates'}</button>
      </div>
      <div className="post-game-table">{report.players.map((player,index)=>{const detected=candidates[index],stored=player.fields[metric];return <div className="toolbar" key={player.rowId}>
        <span>{player.teamName} · P{player.slot+1} · {player.playerId||'—'}</span>
        <input key={`${report.id}:${metric}:${stored?.value}`} aria-label={`${player.playerId} ${metric}`} type="number" min={0} max={postGamePercentMetrics.includes(metric)?100:1e9} step={postGameDecimalMetrics.includes(metric)?'.1':'1'} defaultValue={stored?.value??''} disabled={disabled||busy} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==stored?.value)field(player.rowId,Number(e.target.value));}}/>
        {stored&&<small>{stored.manual?(zh?'人工确认':'Manual'):Math.round(stored.confidence*100)+'%'}</small>}
        {detected&&<small className={detected.confidence<.85?'error':''}>{detected.value??'—'} · {Math.round(detected.confidence*100)}% {detected.value!==null&&!canMergePostGameField(stored,{value:detected.value,confidence:detected.confidence,manual:false,sourcePage:page})&&<span>{zh?'保留已有值；如需更改请人工输入。':'Existing value protected; edit manually to override.'}</span>} <a href={detected.evidence} target="_blank" rel="noreferrer">{zh?'原图':'Evidence'}</a></small>}
      </div>;})}</div>
      <details className="panel"><summary>{zh?'OBS 赛后图形 · 1920×1080':'OBS post-game graphics · 1920×1080'}</summary><p className="muted">{zh?'所有页面读取当前报告的真实字段；缺失数据显示 —。按对位选择链接，可在 OBS 浏览器源中使用相应 URL。':'All overlays display verified report values; unknown metrics remain —. Choose a lane URL for the OBS browser source.'}</p><div className="toolbar"><a href="/overlay/mvp" target="_blank" rel="noreferrer">MVP 1920×1080</a><a href="/overlay/game-progress" target="_blank" rel="noreferrer">{zh?'经济进程':'Gold progress'}</a>{(['clash','jungle','mid','farm','roam'] as const).map(role=><a key={role} href={`/overlay/postgame-compare?role=${role}`} target="_blank" rel="noreferrer">{role} VS</a>)}</div></details>
      <label>{zh?'投票决定的 MVP':'MVP chosen by the vote'}<select aria-label="MVP player" value={report.selectedMvpRowId??''} disabled={disabled} onChange={e=>send({type:'select_mvp',reportId:report.id,rowId:e.target.value||null})}><option value="">{zh?'尚未选择 / 隐藏页面':'Not selected / hide overlay'}</option>{report.players.map(player=><option value={player.rowId} key={player.rowId}>{player.teamName} · {player.playerId||`P${player.slot+1}`}</option>)}</select></label>
      <details><summary>{zh?'当前字段的 10 行数字区域':'Ten numeric regions for this field'}</summary><p className="muted">{zh?'各数据页可能换列或换序，请将每个区域对准右侧列出的对应选手数字。默认矩形仅为校准起点。':'Pages may change columns or row order. Align each region with the named player’s value; defaults are calibration starting points.'}</p>
        <select aria-label="Post-game region" value={row} onChange={e=>setRow(Number(e.target.value))}>{report.players.map((player,index)=><option key={player.rowId} value={index}>{player.teamName} · {player.playerId||`P${player.slot+1}`}</option>)}</select>
        {(['x','y','width','height'] as const).map(key=><label key={key}>{key} %<input type="number" min={0} max={100} step={.1} value={Math.round(region[key]*1000)/10} onChange={e=>{const next={...regions,[`${page}:${metric}:${row}`]:normalizeCaptureRegion({...region,[key]:Number(e.target.value)/100})};setRegions(next);localStorage.setItem(storage,JSON.stringify(next));setCandidates([]);}}/></label>)}
      </details>
    </>}
    <p role="status">{message}</p>
  </details>;
}
