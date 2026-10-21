import { useEffect, useState } from 'react';
type Vendor='openai'|'anthropic'|'gemini'|'deepseek'|'qwen'|'doubao'|'glm'|'kimi'|'baidu'|'custom';
type Config={enabled:boolean;vendor:Vendor;model:string;endpoint:string;configured:boolean};
const names:Record<Vendor,string>={openai:'OpenAI',anthropic:'Anthropic Claude',gemini:'Google Gemini',deepseek:'DeepSeek',qwen:'阿里云 Qwen / 通义千问',doubao:'豆包 / 火山方舟',glm:'智谱 GLM',kimi:'月之暗面 Kimi',baidu:'百度千帆',custom:'自定义 OpenAI 兼容接口'};
const empty:Config={enabled:false,vendor:'openai',model:'',endpoint:'',configured:false};
/**
 * Configuration is a local-only operator action, deliberately separate from match state.
 * Never persist API credentials in localStorage or the broadcast snapshot.
 */
export function AiRecognitionSettings({token,zh}:{token:string;zh:boolean}) {
  const [config,setConfig]=useState<Config>(empty);
  const [apiKey,setApiKey]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/v1/ai-recognition/config',{headers:{Authorization:'Bearer '+token},signal:controller.signal})
      .then(async r=>{if(!r.ok)throw Error('Local Control required');return r.json() as Promise<Config>;})
      .then(setConfig).catch(e=>{if(!controller.signal.aborted)setMessage(String(e));});
    return ()=>controller.abort();
  },[token]);
  async function save(){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/v1/ai-recognition/config',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...config,...(apiKey?{apiKey}:{})})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Save failed');
      setConfig(result as Config);setApiKey('');
      setMessage(zh?'AI 配置已应用（仅当前服务进程有效）。':'AI settings applied for this server session.');
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <section className="panel" aria-label="AI recognition settings">
    <h3>{zh?'AI 识别 · 多厂商 API':'AI Recognition · Multi-provider API'}</h3>
    <p className="muted">{zh?'AI 仅辅助低置信度英雄识别；API 失败时继续使用本地识别。密钥仅保存在服务端内存，重启后须重新输入。':'AI assists low-confidence hero matching. Failures revert to local detection. Credentials stay in server memory and must be re-entered after restart.'}</p>
    <label className="settings-checkbox"><span>{zh?'启用 AI 辅助识别':'Enable AI-assisted recognition'}</span><input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})}/></label>
    <label>{zh?'API 服务商':'API provider'}<select value={config.vendor} onChange={e=>setConfig({...config,vendor:e.target.value as Vendor,endpoint:''})}>{(Object.keys(names) as Vendor[]).map(v=><option key={v} value={v}>{names[v]}</option>)}</select></label>
    <label>{zh?'视觉模型 ID':'Vision model ID'}<input value={config.model} maxLength={100} placeholder="e.g. gpt-4o" onChange={e=>setConfig({...config,model:e.target.value})}/></label>
    <label>{zh?'API Key（留空则沿用本次会话的密钥）':'API key (blank keeps session key)'}<input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={config.configured?'••••••••':'API key'} /></label>
    <label>{zh?'接口 URL（留空使用厂商默认地址）':'Endpoint URL (blank uses provider default)'}<input value={config.endpoint} placeholder={config.vendor==='custom'?'https://provider.example/v1/chat/completions':'Default provider endpoint'} onChange={e=>setConfig({...config,endpoint:e.target.value})}/></label>
    <p className="muted">{zh?'必须选择支持图片输入的模型；仅本机 Control 可修改。国内平台部分模型、地区或账户可能不支持视觉输入。':'Choose a vision-capable model. Local Control only. Some models, regions, or accounts do not support image inputs.'}</p>
    <button type="button" disabled={busy} onClick={save}>{busy?(zh?'保存中…':'Saving…'):(zh?'应用 AI 配置':'Apply AI settings')}</button>
    {message&&<p role="status">{message}</p>}
  </section>;
}
