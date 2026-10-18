import { useEffect,useRef,useState } from 'react';
export function RecoveryPanel({token,zh}:{token:string;zh:boolean}){
  const [message,setMessage]=useState(''),[busy,setBusy]=useState<'status'|'backup'|'export'|null>(null),[failed,setFailed]=useState(false);
  const request=useRef<AbortController>();
  const api=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
  useEffect(()=>{
    setBusy(null);setMessage('');setFailed(false);
    return ()=>{request.current?.abort();request.current=undefined;};
  },[token]);
  async function run(kind:'status'|'backup'|'export'){
    if(request.current||!token)return;
    const controller=new AbortController();request.current=controller;
    const timeout=window.setTimeout(()=>controller.abort(),30000);
    setBusy(kind);setMessage('');setFailed(false);
    try{
      const response=await fetch(api+(kind==='export'?'/api/match-export':'/api/recovery'),{method:kind==='backup'?'POST':'GET',headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
      if(response.status===401||response.status===403)throw new Error(zh?'控制权限已失效，请重新登录后重试。':'Control access expired. Sign in again and retry.');
      let data:Record<string,unknown>;
      try{data=await response.json();}catch{throw new Error(zh?'服务器未返回有效数据，请检查后端连接后重试。':'The server returned invalid data. Check the backend connection and retry.');}
      if(!data||typeof data!=='object')throw new Error(zh?'服务器返回的数据格式无效。':'The server response has an invalid format.');
      if(!response.ok)throw new Error(typeof data.error==='string'&&data.error?data.error:(zh?`操作失败（${response.status}），请检查后端后重试。`:`Request failed (${response.status}). Check the backend and retry.`));
      if(request.current!==controller)return;
      if(kind==='export'){
        if(data.format!=='hok-match-v1'||!Array.isArray(data.entries)||!data.entries.length||typeof data.matchFile!=='string')throw new Error(zh?'导出文件不完整，请重试。':'The export is incomplete. Please retry.');
        const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`hok-match-${Date.now()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        setMessage(zh?'比赛已导出，含阵容、每局映射、历史与上传照片。':'Match exported with rosters, player mappings, history and uploaded portraits.');
      }else if(kind==='backup'){
        if(typeof data.file!=='string'||!data.file)throw new Error(zh?'服务器未确认备份文件，请检查备份状态后重试。':'No backup file was confirmed. Check backup status and retry.');
        setMessage(zh?'备份已保存。':'Backup saved.');
      }else{
        if(!Array.isArray(data.backups))throw new Error(zh?'备份状态无效，请重试。':'Invalid backup status. Please retry.');
        const status=`${zh?'备份数量':'Backups'}: ${data.backups.length} · ${typeof data.lastBackup==='string'&&data.lastBackup?data.lastBackup:'—'}`;
        setFailed(typeof data.error==='string'&&!!data.error);
        setMessage(`${status}${typeof data.error==='string'&&data.error?` · ${data.error}`:''}`);
      }
    }catch(error){
      if(request.current!==controller)return;
      setFailed(true);
      setMessage(controller.signal.aborted?(zh?'请求超时，请检查后端连接。备份前请先查询状态，确认是否已完成。':'Request timed out. Check the backend connection and backup status before trying again.'):error instanceof TypeError?(zh?'无法连接后端，请检查连接后重试。':'Unable to reach the backend. Check the connection and retry.'):error instanceof Error?error.message:(zh?'备份操作失败，请重试。':'Recovery request failed. Please retry.'));
    }finally{
      window.clearTimeout(timeout);if(request.current===controller){request.current=undefined;setBusy(null);}
    }
  }
  return <details className="panel"><summary>{zh?'备份与恢复':'Backup and recovery'}</summary><div className="toolbar">
    <button disabled={!!busy||!token} onClick={()=>void run('status')}>{busy==='status'?(zh?'查询中…':'Checking…'):(zh?'备份状态':'Backup status')}</button>
    <button disabled={!!busy||!token} onClick={()=>void run('backup')}>{busy==='backup'?(zh?'备份中…':'Backing up…'):(zh?'立即备份':'Back up now')}</button>
    <button disabled={!!busy||!token} onClick={()=>void run('export')}>{busy==='export'?(zh?'导出中…':'Exporting…'):(zh?'导出比赛':'Export match')}</button>
  </div><p role={failed?'alert':'status'} className={failed?'error':''}>{message}</p><p className="muted">{zh?'后端每分钟检查变更，保留最近 20 份备份。恢复/导入前停止后端，再运行 npm run recovery -- restore <备份文件> 或 import <比赛文件>。':'The backend checks for changes every minute and keeps 20 backups. Stop it before running npm run recovery -- restore <backup> or import <match>.'}</p></details>;
}
