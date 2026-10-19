import { useCallback, useEffect, useState } from 'react';
import { apiURL } from '../shared/config';

interface ObsStatus {
  configured:boolean;
  connected:boolean;
  scenes:string[];
  programScene:string|null;
  recording:boolean|null;
  error?:string;
}

/** Control-only, local OBS bridge. Never exposes the OBS WebSocket password. */
export function ObsDirectorPanel({token,zh}:{token:string;zh:boolean}) {
  const [status,setStatus]=useState<ObsStatus>();
  const [selected,setSelected]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    try{
      const res=await fetch(`${apiURL}/api/v1/obs/status`,{headers:{Authorization:`Bearer ${token}`},signal,cache:'no-store'});
      if(!res.ok)throw new Error(res.status===403?'OBS control is only available from the local Control page.':'Unable to load OBS status.');
      const next=await res.json() as ObsStatus;
      setStatus(next);
      setSelected(current=>next.scenes.includes(current)?current:next.programScene||next.scenes[0]||'');
    }catch(error){
      if(signal?.aborted)return;
      setStatus({configured:false,connected:false,scenes:[],programScene:null,recording:null,error:error instanceof Error?error.message:'OBS unavailable'});
    }
  },[token]);
  useEffect(()=>{
    const controller=new AbortController();
    void refresh(controller.signal);
    const timer=setInterval(()=>void refresh(controller.signal),4000);
    return()=>{controller.abort();clearInterval(timer);};
  },[refresh]);
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
      <p className="muted">{zh?'当前仅支持本地 OBS 场景切换及录制状态查看；音频淡入淡出、磁盘容量预警、自动触发尚未实现。':'Phase 0 only: local scene switch and recording status. Audio fades, disk alerts and automatic triggers are not yet implemented.'}</p>
    </div>
  </details>;
}
