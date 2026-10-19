import { useCallback,useEffect,useRef,useState } from 'react';
import { OBS_AUDIO_ROLES,OBS_PRESET_IDS,type ObsAudioRole,type ObsCommand,type ObsCommandResult,type ObsConfigUpdate,type ObsPresetId,type ObsPublicConfig,type ObsSnapshot,type ObsStatus } from '../shared/obsProtocol';
import { ObsRequestFailure,requestObs } from './obsDirectorRequest';
import './obsDirector.css';

type Operation='save'|'connect'|'disconnect'|'command'|'cancel';
type Outcome={status:'sending'|'succeeded'|'failed'|'cancelled'|'unconfirmed';message:string;id?:string};
type Result={config?:ObsPublicConfig;status?:ObsStatus;command?:ObsCommandResult;message?:string;outcome?:Outcome};
const copy=<T,>(value:T):T=>structuredClone(value);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const duration=(value:number|null|undefined)=>{
  if(value==null||!Number.isFinite(value))return '—';
  const seconds=Math.floor(Math.max(0,value)/1000);
  return `${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds/60%60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
};
const labels:Record<ObsPresetId,[string,string]>={waiting:['赛前等待','Waiting'],bp:['选禁 BP','BP'],game:['进入比赛','Game'],pause:['暂停','Pause'],postgame:['赛后结算','Postgame'],'matchup-clash':['对抗路','Clash'],'matchup-jungle':['打野','Jungle'],'matchup-mid':['中路','Mid'],'matchup-farm':['发育路','Farm'],'matchup-roam':['游走','Roam'],mvp:['MVP','MVP'],safe:['安全画面','Safe']};
const audioLabels:Record<ObsAudioRole,[string,string]>={game:['游戏','Game'],caster:['解说','Caster'],bgm:['背景音乐','BGM'],sfx:['音效','SFX']};
const newCommandId=()=>globalThis.crypto?.randomUUID?.()??`obs-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function ObsDirectorPanel({token,language,gameReadiness}:{token:string;language:string;gameReadiness?:{ready:boolean;issues:Array<{code:string;message:string}>}}) {
  const zh=language==='zh';
  const [status,setStatus]=useState<ObsStatus>(),[serverConfig,setServerConfig]=useState<ObsPublicConfig>();
  const [draft,setDraft]=useState<ObsPublicConfig>(),[base,setBase]=useState<ObsPublicConfig>();
  const [password,setPassword]=useState(''),[clearPassword,setClearPassword]=useState(false);
  const [busy,setBusy]=useState<Operation>(),[outcome,setOutcome]=useState<Outcome>(),[readError,setReadError]=useState('');
  const [bgmVolume,setBgmVolume]=useState(55),[fadeMs,setFadeMs]=useState(1500),[audioPreset,setAudioPreset]=useState<ObsPresetId>('bp');
  const scope=useRef(0),active=useRef<{id:number;controller:AbortController;commandId?:string}>(),operationNumber=useRef(0),poll=useRef<AbortController>();
  const refs=useRef({token,zh,draft,base,password,clearPassword});refs.current={token,zh,draft,base,password,clearPassword};
  const bgmEdited=useRef(false);
  const dirty=!!draft&&(!same(draft,base)||!!password||clearPassword);
  const conflict=!!base&&!!serverConfig&&!same(base,serverConfig);

  const acceptConfig=useCallback((config:ObsPublicConfig,replace=false)=>{
    setServerConfig(config);
    const current=refs.current;
    if(replace||!current.draft||same(current.draft,current.base)&&!current.password&&!current.clearPassword){
      setDraft(copy(config));setBase(copy(config));
      refs.current={...refs.current,draft:copy(config),base:copy(config)};
      if(replace){setPassword('');setClearPassword(false);refs.current.password='';refs.current.clearPassword=false;}
    }
  },[]);
  const readStatus=useCallback(async()=>{
    if(poll.current||!refs.current.token)return;
    const controller=new AbortController(),generation=scope.current,sentToken=refs.current.token;poll.current=controller;
    try{
      const value=await requestObs<ObsSnapshot>('',sentToken,{signal:controller.signal,timeoutMs:8000});
      if(controller.signal.aborted||generation!==scope.current||sentToken!==refs.current.token)return;
      acceptConfig(value.config);setStatus(value.status);setReadError('');
      const actualCommand=value.status.lastCommand;
      if(actualCommand&&actualCommand.status!=='running'){
        const confirmed:Outcome={id:actualCommand.id,status:actualCommand.status,message:actualCommand.message};
        setOutcome(current=>current?.id===actualCommand.id?confirmed:current);
        const pending=active.current;
        if(pending?.commandId===actualCommand.id){
          // The actual server result can confirm a command even when its HTTP
          // response was lost. It must match this exact command, never another.
          active.current=undefined;pending.controller.abort();setBusy(undefined);setOutcome(confirmed);
        }
      }
      const actual=value.status.inputs.find(input=>input.inputName===value.config.inputs.bgm)?.volume;
      if(!bgmEdited.current&&actual!=null&&Number.isFinite(actual)&&value.status.connection==='connected'){
        // Actual volume keeps changing during fades. Initialize the desired
        // restore level once, then preserve it through fade-out and mute.
        bgmEdited.current=true;
        const restore=actual>0?actual:value.config.presets.waiting.audio.bgm?.volume??.55;
        setBgmVolume(Math.min(100,Math.max(0,Math.round(restore*100))));
      }
    }catch(error){
      if(controller.signal.aborted||generation!==scope.current||sentToken!==refs.current.token)return;
      setReadError(error instanceof ObsRequestFailure&&error.detail?error.detail:(refs.current.zh?'无法读取 OBS 状态，请检查本机服务连接。最后一次读数仅供核对。':'Could not read OBS status. Check the local server connection; the last reading may be stale.'));
    }finally{if(poll.current===controller)poll.current=undefined;}
  },[acceptConfig]);
  useEffect(()=>{
    const generation=scope.current+1;scope.current=generation;active.current?.controller.abort();active.current=undefined;poll.current?.abort();poll.current=undefined;
    setStatus(undefined);setServerConfig(undefined);setDraft(undefined);setBase(undefined);setPassword('');setClearPassword(false);setBusy(undefined);setOutcome(undefined);setReadError('');
    refs.current={...refs.current,draft:undefined,base:undefined,password:'',clearPassword:false};bgmEdited.current=false;
    void readStatus();const timer=setInterval(()=>void readStatus(),2000);
    return()=>{scope.current=generation+1;clearInterval(timer);poll.current?.abort();poll.current=undefined;active.current?.controller.abort();active.current=undefined;};
  },[token,readStatus]);

  function edit(update:(value:ObsPublicConfig)=>void){
    const current=refs.current.draft;if(!current)return;
    const next=copy(current);update(next);refs.current.draft=next;setDraft(next);
  }
  function patch(enabled=draft?.enabled):ObsConfigUpdate {
    const current=refs.current;
    const value=copy(current.draft!);
    const {passwordConfigured,...settings}=value;
    void passwordConfigured;
    return {...settings,enabled:current.clearPassword?false:enabled,...(current.password?{password:current.password}:{}),...(current.clearPassword?{clearPassword:true}:{})};
  }
  function failure(error:unknown,writing:boolean){
    if(error instanceof ObsRequestFailure){
      if(error.code==='rejected'&&error.detail)return error.detail;
      if(error.code==='timeout'||error.code==='network')return writing?(zh?'操作结果未确认。请先核对 OBS 实际画面与状态，再人工重试；系统不会自动重放。':'Result unconfirmed. Check the actual OBS scene and status before retrying; this command will not be replayed automatically.'):(zh?'无法连接本机 OBS 服务，请检查连接后重试。':'Could not reach the local OBS service. Check the connection and retry.');
    }
    return zh?'OBS 返回内容不完整，请刷新状态并核对实际画面。':'OBS returned incomplete data. Refresh its status and check the actual scene.';
  }
  async function run(kind:Operation,work:(signal:AbortSignal)=>Promise<Result>,supersede=false,commandId?:string){
    if(active.current&&!supersede)return;
    active.current?.controller.abort();poll.current?.abort();poll.current=undefined;
    const controller=new AbortController(),id=++operationNumber.current,generation=scope.current,sentToken=token;
    active.current={id,controller,commandId};setBusy(kind);
    setOutcome({status:'sending',id:commandId,message:zh?'正在等待 OBS 确认…':'Waiting for OBS confirmation…'});
    try{
      const result=await work(controller.signal);
      if(controller.signal.aborted||active.current?.id!==id||generation!==scope.current||sentToken!==refs.current.token)return;
      if(result.config)acceptConfig(result.config,true);
      if(result.status)setStatus(result.status);
      if(result.outcome)setOutcome(result.outcome);
      else if(result.command)setOutcome({status:result.command.status==='running'?'unconfirmed':result.command.status,message:result.command.message,id:result.command.id});
      else setOutcome({status:'succeeded',message:result.message??(zh?'设置已保存在本机服务器。':'Settings saved on the local server.')});
      void readStatus();
    }catch(error){
      if(controller.signal.aborted||active.current?.id!==id||generation!==scope.current||sentToken!==refs.current.token)return;
      setOutcome({status:error instanceof ObsRequestFailure&&(error.code==='timeout'||error.code==='network')?'unconfirmed':'failed',id:commandId,message:failure(error,true)});
      void readStatus();
    }finally{if(active.current?.id===id){active.current=undefined;setBusy(undefined);}}
  }
  function save(){
    if(!draft||conflict)return;
    const update=patch();void run('save',async signal=>({config:await requestObs<ObsPublicConfig>('/config',token,{method:'PUT',body:update,signal})}));
  }
  function connect(){
    if(!draft||conflict)return;
    const update=patch(true);
    void run('connect',async signal=>{
      const config=await requestObs<ObsPublicConfig>('/config',token,{method:'PUT',body:update,signal});
      try{
        const connected=await requestObs<ObsStatus>('/connect',token,{method:'POST',signal});
        if(connected.connection!=='connected')throw new ObsRequestFailure('rejected',connected.lastError||(zh?'OBS 连接尚未确认，请核对实际状态。':'OBS connection is not confirmed. Check its actual status.'));
        return {config,status:connected,message:zh?'OBS 已连接，以下显示实际状态。':'OBS connected. The readings below come from OBS.'};
      }catch(error){
        if(signal.aborted)throw error;
        // Saving succeeded even if the subsequent OBS handshake failed. Keep
        // that confirmed config and remove the write-only password from the form.
        return {config,outcome:{status:error instanceof ObsRequestFailure&&(error.code==='timeout'||error.code==='network')?'unconfirmed' as const:'failed' as const,message:failure(error,true)}};
      }
    });
  }
  function command(value:Omit<Extract<ObsCommand,{type:'preset'}>,'id'>|Omit<Extract<ObsCommand,{type:'bgm'}>,'id'>|{type:'cancel'}){
    const body={...value,id:newCommandId()};
    const emergency=value.type==='cancel'||value.type==='preset'&&value.preset==='safe'||value.type==='bgm'&&value.muted===true&&value.fadeMs===0;
    void run(value.type==='cancel'?'cancel':'command',async signal=>({command:await requestObs<ObsCommandResult>('/command',token,{method:'POST',body,signal})}),emergency,body.id);
  }

  const connected=status?.connection==='connected'&&!readError;
  const actualBgm=status?.inputs.find(input=>input.inputName===serverConfig?.inputs.bgm);
  const ready=!!connected&&!busy;
  const emergencyReady=!!connected&&(!busy||busy==='command'||busy==='cancel');
  const connectionName=readError?(zh?'状态未确认':'Status unavailable'):status?({connected:zh?'已连接':'Connected',connecting:zh?'正在连接':'Connecting',reconnecting:zh?'正在重连':'Reconnecting',disconnected:zh?'未连接':'Disconnected',error:zh?'连接失败':'Connection error'}[status.connection]):(zh?'读取状态中…':'Loading status…');
  const outputName=(output:ObsStatus['recording']|undefined)=>!connected||output?.active==null?(zh?'未知':'Unknown'):output.active?(output.paused?(zh?'已暂停':'Paused'):(zh?'进行中':'Active')):(zh?'未开启':'Inactive');
  const health=status?.recordHealth;
  const warnings=[...new Set([...(status?.warnings??[]),...(health?.warnings??[])])];
  const visibleOutcome=outcome??(status?.lastCommand?{status:status.lastCommand.status,message:status.lastCommand.message}:undefined);
  const presetButton=(preset:ObsPresetId)=>{
    const scene=serverConfig?.presets[preset].sceneName;
    const available=!!scene&&!!status?.scenes.includes(scene);
    return <button key={preset} type="button" className={preset==='safe'?'obs-safe':''} disabled={!(preset==='safe'?emergencyReady:ready)||!available||preset==='game'&&gameReadiness?.ready===false} title={available?scene:(zh?'请连接 OBS 并在下方绑定实际场景':'Connect OBS and bind a real scene below')} data-obs-preset={preset} onClick={()=>command({type:'preset',preset})}>{labels[preset][zh?0:1]}{status?.sceneName===scene&&available?<span aria-label={zh?'当前画面':'Current scene'}> ●</span>:null}</button>;
  };
  const selectedPreset=draft?.presets[audioPreset];
  return <section className="panel obs-director" id="obs-director" aria-label={zh?'OBS 导播台':'OBS director'} data-obs-connection={readError?'unknown':status?.connection??'loading'} aria-busy={!!busy}>
    <header className="obs-heading"><div><h2>{zh?'OBS 导播台':'OBS director'}</h2><p className="muted">{zh?'一键切换实际播出画面；录制与直播状态由 OBS 读回。':'Switch the live scene with one button. Recording and streaming readings come from OBS.'}</p></div><div className="obs-connection-actions"><strong className={connected?'obs-connected':''}>{connectionName}</strong><button type="button" disabled={!draft||!!busy||conflict||!!connected&&!dirty||(!password&&!draft.passwordConfigured)||clearPassword} onClick={connect}>{dirty?(zh?'保存并连接 OBS':'Save & connect OBS'):(zh?'连接 OBS':'Connect OBS')}</button><button type="button" disabled={!status||status.connection==='disconnected'||busy==='disconnect'} onClick={()=>void run('disconnect',async signal=>({status:await requestObs<ObsStatus>('/disconnect',token,{method:'POST',signal}),message:zh?'控制连接已断开；OBS 继续当前录制和直播。':'Control disconnected; OBS continues its current recording and stream.'}),true)}>{zh?'断开控制':'Disconnect control'}</button><button type="button" disabled={!!busy} onClick={()=>void readStatus()}>{zh?'刷新状态':'Refresh status'}</button></div></header>
    {readError&&<p role="alert" className="obs-error">{readError}</p>}
    {status?.lastError&&<p role="alert" className="obs-error">{status.lastError}</p>}
    <div className="obs-telemetry">
      <div className="obs-program"><span>{zh?'正在播出':'Program scene'}</span><strong>{connected?status?.sceneName||'—':'—'}</strong>{!connected&&status?.sceneName&&<small>{zh?'上次读数：':'Last reading: '}{status.sceneName}</small>}</div>
      <div data-obs-output="recording"><span>{zh?'录制':'Recording'}</span><strong className={connected&&status?.recording.active?'obs-connected':''}>{outputName(status?.recording)}</strong><small>{duration(status?.recording.durationMs)}</small></div>
      <div data-obs-output="streaming"><span>{zh?'直播':'Streaming'}</span><strong>{outputName(status?.streaming)}</strong><small>{duration(status?.streaming.durationMs)}{status?.streaming.reconnecting?(zh?' · 正在重连':' · reconnecting'):''}</small></div>
      <div data-obs-health={health?.level??'unknown'}><span>{zh?'录制磁盘':'Recording disk'}</span><strong>{connected&&health?.freeBytes!=null?`${(health.freeBytes/1024**3).toFixed(1)} GiB`:'—'}</strong><small>{connected&&health?.estimatedMinutes!=null?`${zh?'预计约':'Approx. '}${Math.floor(health.estimatedMinutes)} ${zh?'分钟可录':'min remaining'}`:(zh?'剩余时长尚不能估算':'Remaining time not yet estimated')}</small></div>
    </div>
    {warnings.length>0&&<ul className="obs-alerts" role="alert">{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>}
    {health?.directory&&<p className="muted obs-record-path">{zh?'实际录制目录':'Recording directory'} · {health.directory} · {health.directorySource==='manual'?(zh?'手动指定':'Manually specified'):(zh?'由 OBS 读取':'Read from OBS')}{health.estimatedMinutes!=null?(zh?' · 时长为估算，随码率变化':' · Time is estimated and varies with bitrate'):''}</p>}
    <div className="obs-presets" aria-label={zh?'播出预设':'Broadcast presets'}>{(['waiting','bp','game','pause','postgame','mvp','safe'] as ObsPresetId[]).map(presetButton)}</div>
    {gameReadiness&&!gameReadiness.ready&&<div className="obs-game-readiness"><span>{zh?'进入比赛前请完成：':'Before entering Game: '}{gameReadiness.issues.map(issue=>issue.message).join(zh?'；':'; ')}</span> <a href={gameReadiness.issues.some(issue=>issue.code==='player_order')?'#player-id-alignment':'#draft-workspace'}>{zh?'前往核对':'Review and repair'}</a></div>}
    <div className="obs-matchups"><span>{zh?'赛后五路对位':'Postgame matchups'}</span>{OBS_PRESET_IDS.filter(id=>id.startsWith('matchup-')).map(presetButton)}</div>
    {!serverConfig?.presets.bp.sceneName&&<p className="muted">{zh?'首次使用：展开下方设置，填写 OBS WebSocket 密码并连接，再选择已有场景与音源。':'First use: open setup below, enter the OBS WebSocket password and connect, then choose your existing scenes and audio inputs.'}</p>}
    <div className="obs-bgm"><div><strong>{zh?'背景音乐':'BGM'}</strong><small>{actualBgm&&connected?`${actualBgm.muted?(zh?'已静音':'Muted'):actualBgm.volume==null?'—':`${Math.round(actualBgm.volume*100)}%`}`:(zh?'尚无实际读数':'No actual reading')}</small></div><label>{zh?'目标音量':'Target volume'}<input aria-label={zh?'音乐目标音量':'BGM target volume'} type="range" min="0" max="100" value={bgmVolume} disabled={!!busy} onChange={event=>{bgmEdited.current=true;setBgmVolume(Number(event.target.value));}}/><span>{bgmVolume}%</span></label><label>{zh?'渐变时长':'Fade duration'}<select aria-label={zh?'音乐渐变时长':'BGM fade duration'} value={fadeMs} disabled={!!busy} onChange={event=>setFadeMs(Number(event.target.value))}><option value="0">0 s</option><option value="1500">1.5 s</option><option value="3000">3 s</option></select></label><button type="button" disabled={!ready||!serverConfig?.inputs.bgm} onClick={()=>command({type:'bgm',volume:bgmVolume/100,muted:false,fadeMs})}>{zh?'音乐渐入':'Fade BGM in'}</button><button type="button" disabled={!ready||!serverConfig?.inputs.bgm} onClick={()=>command({type:'bgm',volume:0,muted:true,fadeMs})}>{zh?'音乐渐出':'Fade BGM out'}</button><button type="button" disabled={!emergencyReady||!serverConfig?.inputs.bgm} onClick={()=>command({type:'bgm',muted:true,fadeMs:0})}>{zh?'静音音乐':'Mute BGM'}</button><button type="button" disabled={!connected||busy==='cancel'||busy==='save'||busy==='connect'||busy==='disconnect'} onClick={()=>command({type:'cancel'})}>{zh?'取消当前渐变':'Cancel current fade'}</button></div>
    {visibleOutcome&&<p className={`obs-outcome obs-outcome-${visibleOutcome.status}`} role={visibleOutcome.status==='failed'||visibleOutcome.status==='unconfirmed'?'alert':'status'} data-obs-command-state={visibleOutcome.status}>{visibleOutcome.status==='succeeded'?(zh?'OBS 已确认 · ':'OBS confirmed · '):visibleOutcome.status==='unconfirmed'?(zh?'待核对 · ':'Unconfirmed · '):visibleOutcome.status==='failed'?(zh?'操作失败 · ':'Failed · '):''}{visibleOutcome.message}</p>}
    <details className="obs-settings"><summary>{zh?'OBS 连接与高级绑定':'OBS connection & advanced bindings'}{dirty?<span> · {zh?'有未保存修改':'Unsaved changes'}</span>:null}</summary>{draft?<div className="obs-settings-content"><div className="obs-connection-form"><label>{zh?'OBS WebSocket 地址':'OBS WebSocket address'}<input type="url" value={draft.url} disabled={!!busy} placeholder="ws://127.0.0.1:4455" onChange={event=>edit(value=>{value.url=event.target.value;})}/></label><label>{zh?'OBS WebSocket 密码':'OBS WebSocket password'}<input type="password" value={password} disabled={!!busy||clearPassword} autoComplete="new-password" placeholder={draft.passwordConfigured?(zh?'已保存；留空保留':'Saved; leave blank to keep it'):(zh?'在 OBS 中查看 WebSocket 密码':'Use the WebSocket password from OBS')} onChange={event=>{refs.current.password=event.target.value;setPassword(event.target.value);}}/></label><label className="obs-checkbox"><input type="checkbox" disabled={!!busy} checked={draft.reconnect} onChange={event=>edit(value=>{value.reconnect=event.target.checked;})}/>{zh?'OBS 断线后自动恢复控制连接':'Reconnect control when OBS disconnects'}</label>{draft.passwordConfigured&&<label className="obs-checkbox"><input type="checkbox" disabled={!!busy} checked={clearPassword} onChange={event=>{refs.current.clearPassword=event.target.checked;setClearPassword(event.target.checked);if(event.target.checked){refs.current.password='';setPassword('');}}}/>{zh?'移除已保存的 OBS 密码':'Remove saved OBS password'}</label>}</div><p className="muted">{zh?'密码只保存在运行本程序的本机服务器；页面不会回显已保存密码。连接地址或密码变更后，请核对连接状态并重新连接。':'The password is stored by the local server and is never returned to this page. After changing the address or password, check the connection state and reconnect.'}</p>
      <fieldset className="obs-input-bindings"><legend>{zh?'音源绑定':'Audio input bindings'}</legend>{OBS_AUDIO_ROLES.map(role=><label key={role}>{audioLabels[role][zh?0:1]}<select aria-label={`${audioLabels[role][zh?0:1]} ${zh?'音源':'audio input'}`} disabled={!!busy||!connected} value={draft.inputs[role]} onChange={event=>edit(value=>{value.inputs[role]=event.target.value;})}><option value="">{zh?'不控制该音源':'Leave unmanaged'}</option>{draft.inputs[role]&&!status?.inputs.some(input=>input.inputName===draft.inputs[role])&&<option value={draft.inputs[role]}>{draft.inputs[role]} · {zh?'当前未找到':'currently missing'}</option>}{status?.inputs.map(input=><option key={input.inputName} value={input.inputName}>{input.inputName}</option>)}</select></label>)}</fieldset>
      <fieldset className="obs-scene-bindings"><legend>{zh?'场景绑定（使用 OBS 已有场景）':'Scene bindings (existing OBS scenes)'}</legend>{OBS_PRESET_IDS.map(preset=><label key={preset}>{labels[preset][zh?0:1]}<select aria-label={`${labels[preset][zh?0:1]} ${zh?'场景':'scene'}`} disabled={!!busy||!connected} value={draft.presets[preset].sceneName} onChange={event=>edit(value=>{value.presets[preset].sceneName=event.target.value;})}><option value="">{zh?'尚未绑定':'Not bound'}</option>{draft.presets[preset].sceneName&&!status?.scenes.includes(draft.presets[preset].sceneName)&&<option value={draft.presets[preset].sceneName}>{draft.presets[preset].sceneName} · {zh?'当前未找到':'currently missing'}</option>}{status?.scenes.map(scene=><option key={scene} value={scene}>{scene}</option>)}</select></label>)}</fieldset>
      <details className="obs-audio-presets"><summary>{zh?'各阶段音量与渐变':'Stage audio levels & fades'}</summary><label>{zh?'编辑阶段':'Edit stage'}<select value={audioPreset} disabled={!!busy} onChange={event=>setAudioPreset(event.target.value as ObsPresetId)}>{OBS_PRESET_IDS.map(preset=><option key={preset} value={preset}>{labels[preset][zh?0:1]}</option>)}</select></label>{selectedPreset&&<><label>{zh?'该阶段渐变时长':'Stage fade duration'}<select disabled={!!busy} value={selectedPreset.fadeMs} onChange={event=>edit(value=>{value.presets[audioPreset].fadeMs=Number(event.target.value);})}>{[...new Set([0,1500,3000,selectedPreset.fadeMs])].sort((a,b)=>a-b).map(ms=><option key={ms} value={ms}>{ms/1000} s</option>)}</select></label><div className="obs-stage-audio">{OBS_AUDIO_ROLES.map(role=>{const target=selectedPreset.audio[role];return <div key={role}><label className="obs-checkbox"><input type="checkbox" disabled={!!busy} checked={!!target} onChange={event=>edit(value=>{if(event.target.checked)value.presets[audioPreset].audio[role]={volume:.55,muted:false};else delete value.presets[audioPreset].audio[role];})}/>{audioLabels[role][zh?0:1]}</label>{target&&<><label>{zh?'音量':'Volume'}<input type="range" disabled={!!busy} min="0" max="100" value={Math.round(target.volume*100)} onChange={event=>edit(value=>{value.presets[audioPreset].audio[role]!.volume=Number(event.target.value)/100;})}/><span>{Math.round(target.volume*100)}%</span></label><label className="obs-checkbox"><input type="checkbox" disabled={!!busy} checked={target.muted} onChange={event=>edit(value=>{value.presets[audioPreset].audio[role]!.muted=event.target.checked;})}/>{zh?'静音':'Mute'}</label></>}</div>;})}</div></>}</details>
      <details className="obs-disk-settings"><summary>{zh?'录制磁盘预警设置':'Recording disk warnings'}</summary><label>{zh?'备用录制目录（OBS 无法提供时使用）':'Fallback recording directory (when unavailable from OBS)'}<input disabled={!!busy} value={draft.recordDirectory} onChange={event=>edit(value=>{value.recordDirectory=event.target.value;})}/></label><div className="obs-thresholds"><label>{zh?'剩余容量警告线':'Free space warning'}<select disabled={!!busy} value={draft.lowDiskGb} onChange={event=>edit(value=>{value.lowDiskGb=Number(event.target.value);})}>{[...new Set([5,10,20,50,draft.lowDiskGb])].sort((a,b)=>a-b).map(gb=><option key={gb} value={gb}>{gb} GiB</option>)}</select></label><label>{zh?'剩余时长警告线':'Remaining time warning'}<select disabled={!!busy} value={draft.remainingMinutesWarning} onChange={event=>edit(value=>{value.remainingMinutesWarning=Number(event.target.value);})}>{[...new Set([15,30,60,120,draft.remainingMinutesWarning])].sort((a,b)=>a-b).map(minutes=><option key={minutes} value={minutes}>{minutes} {zh?'分钟':'min'}</option>)}</select></label></div></details>
      {conflict&&<p className="obs-error" role="alert">{zh?'服务器设置已被其他操作修改。为避免覆盖，请先载入已保存设置，再重新编辑。':'Saved setup changed elsewhere. Reload the saved settings before editing to avoid overwriting them.'}</p>}<div className="toolbar"><button type="button" disabled={!!busy||!dirty||conflict} onClick={save}>{zh?'保存 OBS 设置':'Save OBS settings'}</button><button type="button" disabled={!!busy||!serverConfig} onClick={()=>serverConfig&&acceptConfig(serverConfig,true)}>{zh?'载入已保存设置':'Reload saved settings'}</button></div>
    </div>:<p className="muted">{zh?'正在读取本机 OBS 设置…':'Loading local OBS setup…'}</p>}</details>
  </section>;
}
