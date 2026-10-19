import { useCallback, useEffect, useRef, useState } from 'react';
import { apiURL } from '../shared/config';

interface ObsStatus {
  configured:boolean;
  connected:boolean;
  scenes:string[];
  programScene:string|null;
  recording:boolean|null;
  error?:string;
}

interface ObsAudioInput { name:string;volume:number }

/** Control-only, local OBS bridge. Never exposes the OBS WebSocket password. */
export function ObsDirectorPanel({token,zh}:{token:string;zh:boolean}) {
  const [status,setStatus]=useState<ObsStatus>();
  const [selected,setSelected]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [audioInputs,setAudioInputs]=useState<ObsAudioInput[]>([]);
  const [audioName,setAudioName]=useState('');
  const [targetVolume,setTargetVolume]=useState(100);
  const [fadeMs,setFadeMs]=useState(3000);
  const [audioBusy,setAudioBusy]=useState(false);
  const [audioError,setAudioError]=useState('');
  const polling=useRef(false);
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
  useEffect(()=>{if(status?.connected)void refreshAudio();else setAudioInputs([]);},[status?.connected,refreshAudio]);
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
  const switchScene=async()=>{
    if(!selected||busy||!status?.connected)return;
    setBusy(true);setMessage('');
    try{
      const res=await fetch(`${apiURL}/api/v1/obs/scene`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({scene:selected}),
      });
      const result=await res.json() as ObsStatus&{error?:string};
      if(!res.ok)throw new Error(result.error||'OBS rejected the scene change');
      setStatus(result);
      setMessage(zh?'OBS 已确认切换到目标场景。':'OBS confirmed the program scene change.');
    }catch(error){setMessage(error instanceof Error?error.message:'Scene change failed');}
    finally{setBusy(false);}
  };
  return <details className="panel obs-director" data-testid="obs-director">
    <summary>{zh?'OBS 导播联动（本地）':'OBS director (local)'} · {status?.connected?(zh?'已连接':'Connected'):(zh?'未连接':'Disconnected')}{status?.recording===true?' · REC':''}</summary>
    <div className="obs-director-content">
      <p>{zh?'当前节目场景':'Program scene'}：<strong>{status?.programScene||'—'}</strong> · {zh?'录制':'Recording'}：{status?.recording===null||status?.recording===undefined?'—':status.recording?(zh?'进行中':'Active'):(zh?'未录制':'Stopped')}</p>
      {!status?.configured?<p role="status">{status?.error||(zh?'本地 OBS 尚未配置：在服务端 .env 设置 OBS_WS_URL 和 OBS_WS_PASSWORD。':'Configure OBS_WS_URL and OBS_WS_PASSWORD in the local server environment.')}</p>:
        !status.connected?<p role="status">{status.error||(zh?'正在连接 OBS…':'Connecting to OBS…')}</p>:<>
          <label>{zh?'目标 OBS 场景':'OBS scene'} <select aria-label="OBS scene" value={selected} onChange={e=>setSelected(e.target.value)}>
            {status.scenes.map(scene=><option key={scene} value={scene}>{scene}</option>)}
          </select></label>
          <button type="button" disabled={busy||!selected||selected===status.programScene} onClick={()=>void switchScene()}>{busy?(zh?'切换中…':'Switching…'):(zh?'确认切换 OBS 场景':'Switch OBS scene')}</button>
        </>}
      {message&&<p role="status">{message}</p>}
      <button type="button" onClick={()=>void refresh()}>{zh?'刷新 OBS 连接状态':'Refresh OBS status'}</button>
      {!status?.connected&&<p className="muted">{zh?'连接检查：在 OBS「工具 → WebSocket 服务器设置」启用服务器，确认端口（通常 4455）与密码；本地服务端 .env 中设置 OBS_WS_URL=ws://127.0.0.1:4455 和 OBS_WS_PASSWORD，然后重启本地服务。':'Connection checklist: enable OBS Tools → WebSocket Server Settings, verify port (usually 4455) and password, configure OBS_WS_URL=ws://127.0.0.1:4455 and OBS_WS_PASSWORD in the local server .env, then restart the local server.'}</p>}
      {status?.connected&&<div className="obs-audio-mixer" data-testid="obs-audio-mixer">
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
      <p className="muted">{zh?'本地 OBS 可切换场景、查看录制状态并手动淡入淡出音频；磁盘容量预警和自动触发尚未实现。':'Local OBS supports scene switching, recording status and manual audio fades. Disk alerts and automatic triggers are not yet implemented.'}</p>
    </div>
  </details>;
}
