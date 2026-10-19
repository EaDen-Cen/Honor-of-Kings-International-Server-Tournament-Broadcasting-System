import { createHash, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

/** Minimal OBS WebSocket v5 bridge. No OBS credentials leave this process. */
export interface ObsSnapshot {
  configured:boolean;
  connected:boolean;
  scenes:string[];
  programScene:string|null;
  recording:boolean|null;
  error?:string;
}
type Pending={resolve:(data:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
const sha256=(value:string)=>createHash('sha256').update(value).digest('base64');
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

export function validateLocalObsUrl(value:string) {
  const url=new URL(value);
  if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw new Error('OBS WebSocket URL must be ws://127.0.0.1:<port> with no credentials or path');
  return url.toString();
}

export class ObsBridge {
  private readonly address:string|undefined;
  private readonly password:string;
  private socket?:WebSocket;
  private connection?:Promise<void>;
  private ready=false;
  private pending=new Map<string,Pending>();
  private lastScene:string|null=null;
  private lastScenes:string[]=[];
  private lastRecording:boolean|null=null;
  private lastError='';
  constructor(address=process.env.OBS_WS_URL,password=process.env.OBS_WS_PASSWORD||''){
    this.address=address?validateLocalObsUrl(address):undefined;
    this.password=password;
  }
  get configured(){return !!this.address;}
  private reset(error:Error) {
    this.ready=false;
    this.lastError=error.message;
    this.lastRecording=null;
    for(const [id,waiter] of this.pending){
      clearTimeout(waiter.timer);waiter.reject(error);this.pending.delete(id);
    }
  }
  async connect():Promise<void> {
    if(!this.address)throw new Error('OBS WebSocket is not configured');
    if(this.ready&&this.socket?.readyState===WebSocket.OPEN)return;
    if(this.connection)return this.connection;
    this.connection=new Promise<void>((resolve,reject)=>{
      const ws=new WebSocket(this.address!,{handshakeTimeout:5000});
      this.socket=ws;
      let settled=false;
      const timer=setTimeout(()=>{ws.terminate();fail(new Error('OBS connection timed out'));},6000);
      const success=()=>{if(settled)return;settled=true;clearTimeout(timer);this.ready=true;this.lastError='';resolve();};
      const fail=(error:Error)=>{
        if(!settled){settled=true;clearTimeout(timer);reject(error);}
        if(this.socket===ws)this.reset(error);
      };
      ws.on('message',raw=>{
        let packet:Record<string,unknown>;
        try{packet=record(JSON.parse(raw.toString()));}
        catch{fail(new Error('Invalid OBS WebSocket packet'));ws.close();return;}
        const op=packet.op,d=record(packet.d);
        if(op===0){
          const auth=record(d.authentication);
          if(auth.challenge&&auth.salt){
            if(!this.password){fail(new Error('OBS requires a local WebSocket password'));ws.close();return;}
            const secret=sha256(this.password+String(auth.salt));
            ws.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:65,authentication:sha256(secret+String(auth.challenge))}}));
          }else ws.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:65}}));
        }else if(op===2)success();
        else if(op===5){
          const eventType=d.eventType,event=record(d.eventData);
          if(eventType==='CurrentProgramSceneChanged'&&typeof event.sceneName==='string')this.lastScene=event.sceneName;
          if(eventType==='RecordStateChanged'&&typeof event.outputActive==='boolean')this.lastRecording=event.outputActive;
        }else if(op===7){
          const id=d.requestId,waiter=typeof id==='string'?this.pending.get(id):undefined;
          if(!waiter)return;
          this.pending.delete(id as string);clearTimeout(waiter.timer);
          const status=record(d.requestStatus);
          if(status.result===true)waiter.resolve(record(d.responseData));
          else waiter.reject(new Error(typeof status.comment==='string'?status.comment:'OBS request was rejected'));
        }
      });
      ws.on('error',()=>{fail(new Error('Cannot connect to local OBS WebSocket'));});
      ws.on('close',()=>{fail(new Error('OBS disconnected'));});
    }).finally(()=>{this.connection=undefined;});
    return this.connection;
  }
  private async request(type:string,data?:Record<string,unknown>):Promise<Record<string,unknown>>{
    await this.connect();
    if(!this.socket||this.socket.readyState!==WebSocket.OPEN)throw new Error('OBS disconnected');
    return new Promise((resolve,reject)=>{
      const id=randomUUID();
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('OBS request timed out'));},5000);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket!.send(JSON.stringify({op:6,d:{requestType:type,requestId:id,requestData:data||{}}}));}
      catch{clearTimeout(timer);this.pending.delete(id);reject(new Error('OBS request could not be sent'));}
    });
  }
  async status():Promise<ObsSnapshot>{
    if(!this.configured)return{configured:false,connected:false,scenes:[],programScene:null,recording:null};
    try{
      const [scenes,recording]=await Promise.allSettled([this.request('GetSceneList'),this.request('GetRecordStatus')]);
      if(scenes.status==='fulfilled'){
        const data=scenes.value;
        this.lastScenes=Array.isArray(data.scenes)?data.scenes.map(item=>record(item).sceneName).filter((x):x is string=>typeof x==='string'):[];
        if(typeof data.currentProgramSceneName==='string')this.lastScene=data.currentProgramSceneName;
      }else throw scenes.reason;
      if(recording.status==='fulfilled')this.lastRecording=typeof recording.value.outputActive==='boolean'?recording.value.outputActive:null;
      return {configured:true,connected:this.ready,scenes:this.lastScenes,programScene:this.lastScene,recording:this.lastRecording};
    }catch(error){
      const message=error instanceof Error?error.message:'OBS unavailable';
      this.lastError=message;
      return{configured:true,connected:false,scenes:this.lastScenes,programScene:this.lastScene,recording:null,error:message};
    }
  }
  async switchScene(name:string):Promise<ObsSnapshot>{
    if(typeof name!=='string'||!name.trim()||name.length>128)throw new Error('Invalid OBS scene name');
    const status=await this.status();
    if(!status.connected)throw new Error(status.error||'OBS is disconnected');
    if(!status.scenes.includes(name))throw new Error('Scene is not present in OBS');
    await this.request('SetCurrentProgramScene',{sceneName:name});
    // Read back real OBS status; request success alone is not enough.
    const next=await this.status();
    if(next.programScene!==name)throw new Error('OBS did not confirm scene change');
    return next;
  }
  close() {
    this.socket?.close();
    this.reset(new Error('OBS bridge closed'));
  }
}
