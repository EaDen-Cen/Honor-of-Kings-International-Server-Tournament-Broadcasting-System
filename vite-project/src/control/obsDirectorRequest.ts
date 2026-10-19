import { apiURL } from '../shared/config';
import { validObsResponse } from './obsDirectorValidation';

export class ObsRequestFailure extends Error {
  constructor(readonly code:'timeout'|'network'|'rejected'|'invalidResponse'|'aborted',readonly detail='') {
    super(detail||code);
  }
}

/** A timed-out write is never replayed: OBS may already have received it. */
export async function requestObs<T>(path:string,token:string,options:{method?:'GET'|'PUT'|'POST';body?:unknown;signal?:AbortSignal;timeoutMs?:number}={}):Promise<T> {
  const controller=new AbortController();
  let timedOut=false;
  const abort=()=>controller.abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)controller.abort();
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},options.timeoutMs??12000);
  try {
    const response=await fetch(`${apiURL}/api/obs${path}`,{
      method:options.method??'GET',cache:'no-store',signal:controller.signal,
      headers:{Authorization:`Bearer ${token}`,...(options.body!==undefined?{'Content-Type':'application/json'}:{})},
      ...(options.body!==undefined?{body:JSON.stringify(options.body)}:{}),
    });
    let value:unknown;
    try{value=await response.json();}catch{throw new ObsRequestFailure('invalidResponse');}
    controller.signal.throwIfAborted();
    if(!response.ok){
      const detail=value&&typeof value==='object'&&'error' in value&&typeof value.error==='string'?value.error:'';
      throw new ObsRequestFailure('rejected',detail);
    }
    if(!validObsResponse(path,value))throw new ObsRequestFailure('invalidResponse');
    return value as T;
  }catch(error){
    if(timedOut)throw new ObsRequestFailure('timeout');
    if(options.signal?.aborted)throw new ObsRequestFailure('aborted');
    if(error instanceof ObsRequestFailure)throw error;
    throw new ObsRequestFailure('network');
  }finally{
    clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
  }
}
