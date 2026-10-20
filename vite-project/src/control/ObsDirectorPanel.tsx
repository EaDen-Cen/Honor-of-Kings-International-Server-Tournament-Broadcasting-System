import { useCallback, useEffect, useRef, useState } from 'react';
import { apiURL } from '../shared/config';
import type { MatchState } from '../shared/types';
import { obsCueKeys,obsCueLabels,parseObsCueMap,recommendedObsCue,resolveObsCue,type ObsCueMap } from './obsCues';

interface ObsStatus {
  configured:boolean;
  connected:boolean;
  scenes:string[];
  programScene:string|null;
  recording:boolean|null;
  error?:string;
}

interface ObsAudioInput { name:string;volume:number }
interface ObsBrowserSource {name:string;enabled:boolean;index:number;width:number|null;height:number|null}

/** Control-only, local OBS bridge. Never exposes the OBS WebSocket password. */
export function ObsDirectorPanel({token,zh,state}:{token:string;zh:boolean;state:MatchState}) {
  const suggested=recommendedObsCue(state);
  const [cueMap,setCueMap]=useState<ObsCueMap>(()=>{
    try{return parseObsCueMap(localStorage.getItem('hok-obs-scene-cues-v1'));}catch{return {};}
  });
  useEffect(()=>{try{localStorage.setItem('hok-obs-scene-cues-v1',JSON.stringify(cueMap));}catch{/* Storage disabled: session-only mapping. */}},[cueMap]);
  const [status,setStatus]=useState<ObsStatus>();
  const [selected,setSelected]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [audioInputs,setAudioInputs]=useState<ObsAudioInput[]>([]);
  const [audioName,setAudioName]=useState('');
  const [targetVolume,setTargetVolume]=useState(100);
  const [fadeMs,setFadeMs]=useState(3000);
  const [layout,setLayout]=useState<{scene:string;sources:ObsBrowserSource[]}|null>(null);
  const [layoutError,setLayoutError]=useState('');
  const [layoutBusy,setLayoutBusy]=useState(false);
  const [audioBusy,setAudioBusy]=useState(false);
  const [audioError,setAudioError]=useState('');
  const polling=useRef(false);
  const audioInitialized=useRef(false);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(polling.current)return;
    polling.current=true;
    try{
      const res=await fetch(`${apiURL}/api/v1/obs/status`,{headers:{Authorization:`Bearer ${token}`},signal,cache:'no-store'});
      if(!res.ok)throw new Error(res.status===403?'OBS control is only available from the local Control page.':'Unable to load OBS status.');
      const next=await res.json() as ObsStatus;
      setStatus(next);
      setSelected(current=>next.scenes.includes(current)?current:next.programScene||next.scenes[0]||'');
    }catch(error){
      if(signal?.aborted)return;
      setStatus({configured:false,connected:false,scenes:[],programScene:null,recording:null,error:error instanceof Error?error.message:'OBS unavailable'});
    }finally{polling.current=false;}
  },[token]);
  const refreshAudio=useCallback(async()=>{
    try{
      const res=await fetch(`${apiURL}/api/v1/obs/audio`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const result=await res.json() as {inputs?:ObsAudioInput[];error?:string};
      if(!res.ok)throw new Error(result.error||'Unable to load OBS audio inputs');
      const inputs=result.inputs??[];
      setAudioInputs(inputs);
      if(!audioInitialized.current&&inputs[0]){
        setTargetVolume(Math.round(inputs[0].volume*100));
        audioInitialized.current=true;
      }
      setAudioName(current=>inputs.some(input=>input.name===current)?current:inputs[0]?.name??'');
      setAudioError('');
    }catch(error){setAudioError(error instanceof Error?error.message:'OBS audio unavailable');}
  },[token]);
  useEffect(()=>{
    const controller=new AbortController();
    void refresh(controller.signal);
    const timer=setInterval(()=>void refresh(controller.signal),4000);
    return()=>{controller.abort();clearInterval(timer);};
  },[refresh]);
  useEffect(()=>{if(status?.connected)void refreshAudio();else{setAudioInputs([]);audioInitialized.current=false;}},[status?.connected,refreshAudio]);
  const inspectLayout=async()=>{
    if(!selected||!status?.connected||layoutBusy)return;
    setLayoutBusy(true);setLayoutError('');setLayout(null);
    try{
      const res=await fetch(`${apiURL}/api/v1/obs/layout?scene=${encodeURIComponent(selected)}`,{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store',
      });
      const result=await res.json() as {scene?:string;sources?:ObsBrowserSource[];error?:string};
      if(!res.ok)throw new Error(result.error||'OBS layout inspection failed');
      setLayout({scene:result.scene??selected,sources:result.sources??[]});
    }catch(error){setLayoutError(error instanceof Error?error.message:'OBS layout unavailable');}
    finally{setLayoutBusy(false);}
  };
  const fadeAudio=async(target:number)=>{
    if(audioBusy||!audioName||!status?.connected)return;
    setAudioBusy(true);setAudioError('');
    try{
      const res=await fetch(`${apiURL}/api/v1/obs/audio`,{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({inputName:audioName,targetVolume:target/100,durationMs:fadeMs}),
      });
      const result=await res.json() as {error?:string;volume?:number};
      if(!res.ok)throw new Error(result.error||'OBS audio fade failed');
      await refreshAudio();
    }catch(error){setAudioError(error instanceof Error?error.message:'OBS audio fade failed');}
    finally{setAudioBusy(false);}
  };
  const switchScene=async(target=selected)=>{
    if(!target||busy||!status?.connected||!status.scenes.includes(target)||target===status.programScene)return;
    setBusy(true);setMessage('');
    try{
      const res=await fetch(`${apiURL}/api/v1/obs/scene`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({scene:target}),
      });
      const result=await res.json() as ObsStatus&{error?:string};
      if(!res.ok)throw new Error(result.error||'OBS rejected the scene change');
      if(result.programScene!==target)throw new Error(zh?'OBS 未确认切换到目标场景。':'OBS did not confirm the requested scene.');
      setStatus(result);setSelected(target);
      setMessage(zh?`OBS 已确认切换至「${target}」。`:`OBS confirmed program scene: ${target}.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Scene change failed');}
    finally{setBusy(false);}
  };
  return <details className="panel obs-director" data-testid="obs-director">
    <summary>{zh?'OBS 导播工作区（本地）':'OBS director workspace (local)'} · {status?.connected?(zh?'已连接':'Connected'):(zh?'未连接':'Disconnected')}{status?.recording===true?' · REC':''}</summary>
    <div className="obs-director-content">
      <div className="obs-director-status-grid" aria-label={zh?'OBS 运行状态':'OBS status'}>
        <div className="obs-status-tile"><span>{zh?'连接状态':'Connection'}</span><strong>{status?.connected?(zh?'已连接':'Connected'):(zh?'未连接':'Disconnected')}</strong></div>
        <div className="obs-status-tile"><span>{zh?'当前节目场景':'Program scene'}</span><strong>{status?.programScene||'—'}</strong></div>
        <div className="obs-status-tile"><span>{zh?'录制状态':'Recording'}</span><strong>{status?.recording===true?'● REC':status?.recording===false?(zh?'未录制':'Stopped'):'—'}</strong></div>
        <div className="obs-status-tile"><span>{zh?'比赛阶段建议':'Suggested stage'}</span><strong>{zh?obsCueLabels[suggested].zh:obsCueLabels[suggested].eng}</strong></div>
      </div>
      <div className="obs-director-toolbar">
        <button type="button" onClick={()=>void refresh()}>{zh?'刷新 OBS 状态':'Refresh OBS status'}</button>
        <span className="muted">{zh?'只读比赛状态；不会因 OCR 或比赛进度自动切镜。':'Match state is read-only here; OCR and match progress never switch scenes automatically.'}</span>
      </div>
      {!status?.configured?<p role="status">{status?.error||(zh?'本地 OBS 尚未配置：在服务端 .env 设置 OBS_WS_URL 和 OBS_WS_PASSWORD。':'Configure OBS_WS_URL and OBS_WS_PASSWORD in the local server environment.')}</p>:
        !status.connected?<p role="status">{status.error||(zh?'正在连接 OBS…':'Connecting to OBS…')}</p>:null}
      {!status?.connected&&<p className="muted">{zh?'连接检查：在 OBS「工具 → WebSocket 服务器设置」启用服务器，确认端口（通常 4455）与密码；本地服务端 .env 中设置 OBS_WS_URL=ws://127.0.0.1:4455 和 OBS_WS_PASSWORD，然后重启本地服务。':'Enable OBS Tools → WebSocket Server Settings, verify port (usually 4455) and password, configure OBS_WS_URL and OBS_WS_PASSWORD in the local server .env, then restart the local server.'}</p>}
      <div className="obs-workspace-grid">
        <section className="obs-workspace-card obs-cue-card" aria-label={zh?'赛事场景联动':'Match scene cues'}>
          <div className="obs-workspace-heading">
            <h4>{zh?'赛事阶段 · 一键切镜':'Match stages · scene cues'}</h4>
            <span className="muted">{zh?'手动确认执行':'Manual only'}</span>
          </div>
          <p className="muted">{zh?'根据导播控制台当前 BP、开局及赛后状态提示推荐场景；先将每个阶段绑定到 OBS 中的真实场景。':'Suggestions follow Control BP, game and postgame state. Map each stage to an actual OBS scene first.'}</p>
          <div className="obs-cue-list">
            {obsCueKeys.map(cue=>{
              const mapped=resolveObsCue(cue,status?.scenes??[],cueMap);
              const active=!!mapped&&status?.programScene===mapped;
              const recommended=cue===suggested;
              return <div className={`obs-cue-row${recommended?' is-recommended':''}`} key={cue} data-testid={`obs-cue-${cue}`}>
                <label htmlFor={`obs-cue-map-${cue}`}>{zh?obsCueLabels[cue].zh:obsCueLabels[cue].eng}{recommended?<small> · {zh?'建议':'Suggested'}</small>:null}</label>
                <select id={`obs-cue-map-${cue}`} aria-label={`OBS cue map ${cue}`}
                  value={cueMap[cue]??mapped??''}
                  onChange={e=>setCueMap(previous=>({...previous,[cue]:e.target.value}))}>
                  <option value="">{zh?'未绑定':'Unmapped'}</option>
                  {(status?.scenes??[]).map(scene=><option key={scene} value={scene}>{scene}</option>)}
                </select>
                <button type="button" disabled={!status?.connected||busy||!mapped||active}
                  onClick={()=>void switchScene(mapped??'')}>{active?(zh?'播出中':'On air'):(zh?'切换':'Take')}</button>
              </div>;
            })}
          </div>
        </section>
        <section className="obs-workspace-card" aria-label={zh?'手动场景与音源':'Manual scene and audio'}>
          <div className="obs-workspace-heading"><h4>{zh?'手动场景控制':'Manual scene control'}</h4></div>
          <div className="obs-director-toolbar">
            <label>{zh?'目标 OBS 场景':'OBS scene'} <select aria-label="OBS scene" value={selected} disabled={!status?.connected||busy} onChange={e=>setSelected(e.target.value)}>
              {(status?.scenes??[]).map(scene=><option key={scene} value={scene}>{scene}</option>)}
            </select></label>
            <button type="button" disabled={busy||!status?.connected||!selected||selected===status.programScene}
              onClick={()=>void switchScene()}>{busy?(zh?'切换中…':'Switching…'):(zh?'确认切换 OBS 场景':'Switch OBS scene')}</button>
          </div>
          {message&&<p role="status">{message}</p>}
          <div className="obs-source-guide">
            <h4>{zh?'OBS 浏览器源布局':'OBS Browser Source layout'}</h4>
            <p>{zh?'以下为建议源路径，均保持 1920×1080 透明画布。将 HUD 置于游戏捕获上层；比分条宽度在「局内 HUD」中调整。':'Suggested overlay paths use a 1920×1080 transparent canvas. Place the HUD above game capture and adjust its width in Live HUD.'}</p>
            <div><code>/overlay/draft</code><span>{zh?'BP 选禁图形':'Draft overlay'}</span></div>
            <div><code>/overlay/game-hud</code><span>{zh?'局内比分 HUD':'Game HUD'}</span></div>
            <div><code>/overlay/mvp</code><span>{zh?'赛后 MVP':'MVP overlay'}</span></div>
            <div><code>/overlay/game-progress</code><span>{zh?'经济时间线':'Game progress'}</span></div>
            <p className="muted">{zh?'画面联动只切换已映射的 OBS 场景；不会自动添加、删除或修改 OBS 来源。':'Scene cues do not create, delete or modify OBS sources.'}</p>
            <div className="obs-layout-audit" data-testid="obs-layout-audit">
              <button type="button" disabled={!status?.connected||!selected||layoutBusy} onClick={()=>void inspectLayout()}>
                {layoutBusy?(zh?'检查中…':'Inspecting…'):(zh?'检查所选场景的浏览器源布局':'Inspect selected scene layout')}
              </button>
              {layoutError&&<p role="alert">{layoutError}</p>}
              {layout?.scene===selected&&<div role="status">
                {layout.sources.length===0?<p>{zh?'此场景未发现可检查的 OBS 浏览器源。':'No inspectable Browser Sources found in this scene.'}</p>:
                  layout.sources.map((source,i)=><div key={`${source.name}:${i}`}>
                    <strong>{source.name}</strong>
                    <span>{source.width??'?'} × {source.height??'?'} · {source.enabled?(zh?'已启用':'Enabled'):(zh?'已隐藏':'Hidden')}</span>
                    {(source.width!==1920||source.height!==1080)&&<small>{zh?'请核对设计分辨率（建议 1920×1080）':'Check source canvas size (recommended 1920×1080)'}</small>}
                  </div>)}
              </div>}
            </div>
          </div>
        </section>
      </div>
      {status?.connected&&<div className="obs-audio-mixer obs-workspace-card" data-testid="obs-audio-mixer">
        <h4>{zh?'OBS 音频淡入淡出':'OBS audio fades'}</h4>
        <div className="toolbar">
          <label>{zh?'音频源':'Audio input'} <select aria-label="OBS audio input" value={audioName} disabled={audioBusy} onChange={e=>{
            const input=audioInputs.find(item=>item.name===e.target.value);
            setAudioName(e.target.value);if(input)setTargetVolume(Math.round(input.volume*100));
          }}>{audioInputs.map(input=><option key={input.name} value={input.name}>{input.name}</option>)}</select></label>
          <span>{zh?'当前音量':'Current'}：{audioInputs.find(input=>input.name===audioName)?Math.round(audioInputs.find(input=>input.name===audioName)!.volume*100)+'%':'—'}</span>
          <button type="button" disabled={audioBusy} onClick={()=>void refreshAudio()}>{zh?'刷新音频源':'Refresh inputs'}</button>
        </div>
        {audioInputs.length===0?<p className="muted">{zh?'未找到可控制音量的 OBS 音频源。请在 OBS 混音器确认来源，并刷新。':'No audio-capable OBS inputs found. Check the OBS audio mixer and refresh.'}</p>:<>
          <div className="toolbar">
            <label htmlFor="obs-target-volume">{zh?'淡入目标音量':'Fade-in target'}：{targetVolume}%</label>
            <input id="obs-target-volume" aria-label="OBS target volume" type="range" min={0} max={200} step={5} value={targetVolume} disabled={audioBusy} onChange={e=>setTargetVolume(Number(e.target.value))}/>
            <label>{zh?'渐变时长':'Fade duration'} <select aria-label="OBS fade duration" value={fadeMs} disabled={audioBusy} onChange={e=>setFadeMs(Number(e.target.value))}>
              <option value={0}>{zh?'立即':'Instant'}</option><option value={1000}>1s</option><option value={3000}>3s</option><option value={5000}>5s</option>
            </select></label>
          </div>
          <div className="toolbar">
            <button type="button" disabled={audioBusy} onClick={()=>void fadeAudio(0)}>{zh?'淡出至静音':'Fade out to silence'}</button>
            <button type="button" disabled={audioBusy} onClick={()=>void fadeAudio(targetVolume)}>{zh?'淡入至目标音量':'Fade to target volume'}</button>
          </div>
          <p className="muted">{zh?'只调整所选音频源音量，不改变 OBS 录制或直播状态；淡出不会修改混音器静音开关。':'Only adjusts the selected input volume. Recording and streaming remain unchanged; fade-out does not toggle OBS mute.'}</p>
        </>}
        {audioError&&<p role="alert">{audioError}</p>}
      </div>}
      <p className="muted">{zh?'OBS 场景联动只在导播点击后执行；音频仍为手动渐变。磁盘容量预警与自动切镜尚未实现。':'Scene cues execute only when the director clicks Take; audio fades remain manual. Disk alerts and automatic scene switching are not implemented.'}</p>
    </div>
  </details>;
}
