import { allPoolHeroes } from '../src/shared/heroPool.js';
/**
 * Optional cloud vision recognition. The API key is intentionally process-memory only:
 * it is never written to match.json, shipped to overlays, or sent to the browser in GET.
 * Only the local Control operator may configure it (route access check lives in server.ts).
 *
 * Provider adapters have distinct wire formats; model names are operator-supplied because
 * availability and vision support vary by vendor/account/region.
 */
export type AiVendor = 'openai'|'anthropic'|'gemini'|'deepseek'|'qwen'|'doubao'|'glm'|'kimi'|'baidu'|'custom';
export interface AiPublicConfig { enabled: boolean; vendor: AiVendor; model: string; endpoint: string; configured: boolean }
type AiSettings = Omit<AiPublicConfig,'configured'> & { apiKey: string };
const defaults: Record<AiVendor,string> = {
  openai:'https://api.openai.com/v1/chat/completions',
  anthropic:'https://api.anthropic.com/v1/messages',
  gemini:'https://generativelanguage.googleapis.com/v1beta',
  deepseek:'https://api.deepseek.com/chat/completions',
  qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  doubao:'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  glm:'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  kimi:'https://api.moonshot.cn/v1/chat/completions',
  baidu:'https://qianfan.baidubce.com/v2/chat/completions',
  custom:'',
};
const vendors = Object.keys(defaults) as AiVendor[];
const heroNames = new Map(allPoolHeroes.map(hero => [hero.id, `${hero.chineseName} / ${hero.englishName}`]));
let settings:AiSettings={enabled:false,vendor:'openai',model:'',endpoint:'',apiKey:''};
let active=false;
export const aiPublicConfig=():AiPublicConfig=>({enabled:settings.enabled,vendor:settings.vendor,model:settings.model,endpoint:settings.endpoint,configured:Boolean(settings.apiKey)});
export function setAiConfig(input:unknown):AiPublicConfig {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid AI configuration');
  const v=input as Record<string,unknown>;
  if(!vendors.includes(v.vendor as AiVendor)||typeof v.enabled!=='boolean'||typeof v.model!=='string'||v.model.length>100||typeof v.endpoint!=='string'||v.endpoint.length>300)throw Error('Invalid AI configuration');
  if(v.apiKey!==undefined&&(typeof v.apiKey!=='string'||v.apiKey.length>512))throw Error('Invalid API key');
  // Never allow arbitrary network targets. Custom endpoints require HTTPS and public hosts.
  const vendor=v.vendor as AiVendor;
  const endpoint=v.endpoint.trim()||defaults[vendor];
  const url=new URL(endpoint);
  // Reject local/private destinations before forwarding an operator-supplied key.
  const host=url.hostname.toLowerCase();
  const ipv4=host.split('.').map(Number);
  const privateIp=ipv4.length===4&&ipv4.every(Number.isInteger)&&
    (ipv4[0]===0||ipv4[0]===10||ipv4[0]===127||ipv4[0]===169&&ipv4[1]===254||
      ipv4[0]===192&&ipv4[1]===168||ipv4[0]===172&&ipv4[1]>=16&&ipv4[1]<=31);
  if(url.protocol!=='https:'||url.username||url.password||
     (url.port&&url.port!=='443')||!host.includes('.')||
     host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||
     host.includes(':')||privateIp) throw Error('AI endpoint must be public HTTPS');
  if(vendor!=='custom'&&url.origin!==new URL(defaults[vendor]).origin)throw Error('Use Custom for third-party gateways');
  settings={enabled:v.enabled,vendor,model:v.model.trim(),endpoint,apiKey:typeof v.apiKey==='string'&&v.apiKey.length?v.apiKey:settings.apiKey};
  return aiPublicConfig();
}
function imagePayload(image:string){
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if(!match||match[2].length>2_700_000)throw Error('Unsupported/oversized AI image');
  return {mime:'image/'+match[1],data:match[2]};
}
function parseCandidate(raw:string,allowed:number[]):{heroId:number;confidence:number}|undefined{
  const text=raw.replace(/^```(?:json)?\s*|\s*```$/g,'').trim();
  let value:unknown;
  try{value=JSON.parse(text);}catch{return;}
  if(!value||typeof value!=='object')return;
  const v=value as Record<string,unknown>;
  if(!Number.isSafeInteger(v.heroId)||!allowed.includes(v.heroId as number)||typeof v.confidence!=='number'||!Number.isFinite(v.confidence)||v.confidence<0||v.confidence>1)return;
  return {heroId:v.heroId as number,confidence:v.confidence};
}
/** One cloud request maximum. No retries on live frames, so a failing API cannot flood. */
export async function recognizeAiHero(image:string,allowedHeroIds:number[]):Promise<{heroId:number;confidence:number}|undefined>{
  if(!settings.enabled||!settings.apiKey||!settings.model||active||!allowedHeroIds.length||allowedHeroIds.length>250)return;
  const {mime,data}=imagePayload(image);
  active=true;
  const current={...settings};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),4500);
  try{
    const options=allowedHeroIds.map(id=>id+': '+(heroNames.get(id)??'Unknown')).join('; ');
    const prompt='Identify the Honor of Kings hero in this cropped game image. Match visual identity against this exact ID-to-name catalog: '+options+'. Return ONLY JSON {"heroId":number,"confidence":number}. If uncertain return {"heroId":0,"confidence":0}. Only use a supplied ID.';
    let target=current.endpoint; const headers:Record<string,string>={'Content-Type':'application/json'}; let body:unknown;
    if(current.vendor==='gemini'){
      target=target.replace(/\/$/,'')+'/models/'+encodeURIComponent(current.model)+':generateContent';
      headers['x-goog-api-key']=current.apiKey;
      body={contents:[{parts:[{text:prompt},{inline_data:{mime_type:mime,data}}]}],generationConfig:{temperature:0,maxOutputTokens:100}};
    }else if(current.vendor==='anthropic'){
      headers['x-api-key']=current.apiKey;headers['anthropic-version']='2023-06-01';
      body={model:current.model,max_tokens:100,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image',source:{type:'base64',media_type:mime,data}}]}]};
    }else{
      headers.Authorization='Bearer '+current.apiKey;
      body={model:current.model,temperature:0,max_tokens:100,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:image}}]}]};
    }
    const response=await fetch(target,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
    if(!response.ok)throw Error('AI provider HTTP '+response.status);
    const json=await response.json() as {candidates?:{content?:{parts?:{text?:string}[]}}[];content?:{text?:string}[];choices?:{message?:{content?:string}}[]};
    const reply=current.vendor==='gemini'?json.candidates?.[0]?.content?.parts?.[0]?.text:current.vendor==='anthropic'?json.content?.[0]?.text:json.choices?.[0]?.message?.content;
    return typeof reply==='string'?parseCandidate(reply,allowedHeroIds):undefined;
  }finally{clearTimeout(timeout);active=false;}
}
export async function recognizeAiWithFallback<T extends {candidates:{heroId:number;confidence:number}[]}>(image:string,ids:number[]|undefined,local:()=>Promise<T>):Promise<T>{
  const result=await local();
  // Existing local recognition remains authoritative unless AI finds a strong candidate.
  if(!settings.enabled||!ids?.length||result.candidates[0]?.confidence>=0.92)return result;
  try{
    const match=await recognizeAiHero(image,ids);
    if(match&&match.confidence>=0.85)return {...result,candidates:[match,...result.candidates.filter(x=>x.heroId!==match.heroId)]};
  }catch{/* Network, quota, model errors and timeouts fall back to the tested local matcher. */}
  return result;
}
