import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Role} from '../src/shared/types.js';
import type {ObsService} from './obs/ObsService.js';

type DirectorService=Pick<ObsService,'getSnapshot'|'getConfig'|'getStatus'|'updateConfig'|'connect'|'disconnect'|'command'>;

/** OBS credentials, output paths and controls are available only to Control.
 * This API is separate from match actions and never enters a match export. */
export function createObsRoutes(service:DirectorService,roleFor:(token:unknown)=>Role|undefined,allowedOrigins:readonly string[]=[]){
  return async(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>=>{
    const path=url.pathname;
    if(path!=='/api/obs'&&!path.startsWith('/api/obs/'))return false;
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    const role=roleFor(req.headers.authorization?.replace(/^Bearer /,''));
    if(role!=='control'){json(role?403:401,{error:role?'Control only':'Director access token required'});req.resume();return true;}
    const origin=req.headers.origin;
    if(origin&&!allowedOrigins.includes(origin)&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`){
      json(403,{error:'Origin rejected'});req.resume();return true;
    }
    if(req.method==='GET'){
      if(path==='/api/obs')json(200,service.getSnapshot());
      else if(path==='/api/obs/config')json(200,service.getConfig());
      else if(path==='/api/obs/status')json(200,service.getStatus());
      else json(404,{error:'Unknown OBS endpoint'});
      return true;
    }
    const config=path==='/api/obs/config';
    const action=['/api/obs/connect','/api/obs/disconnect','/api/obs/command'].includes(path);
    if(!config&&!action){json(404,{error:'Unknown OBS endpoint'});req.resume();return true;}
    if(config?req.method!=='PUT':req.method!=='POST'){json(405,{error:config?'PUT required':'POST required'});req.resume();return true;}
    let input:unknown={};
    try{
      const chunks:Buffer[]=[];let size=0;
      req.setTimeout(10000,()=>req.destroy());
      for await(const chunk of req){
        size+=chunk.length;
        if(size>65536){json(413,{error:'OBS request too large'});req.resume();return true;}
        chunks.push(chunk);
      }
      req.setTimeout(0);
      if(size){
        if(!req.headers['content-type']?.startsWith('application/json')){json(415,{error:'JSON required'});return true;}
        try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(400,{error:'Invalid OBS request'});return true;}
      }
      if(!input||typeof input!=='object'||Array.isArray(input)){json(400,{error:'Invalid OBS request'});return true;}
      if(config)json(200,await service.updateConfig(input));
      else if(path==='/api/obs/connect')json(200,await service.connect());
      else if(path==='/api/obs/disconnect')json(200,await service.disconnect());
      else json(200,await service.command(input));
    }catch(error){
      // ObsService reports bounded, sanitized messages, never raw OBS payloads.
      const code=error&&typeof error==='object'&&'status' in error?error.status:undefined;
      json(typeof code==='number'&&Number.isInteger(code)&&code>=400&&code<=599?code:400,{error:error instanceof Error?error.message:'OBS operation failed'});
    }
    return true;
  };
}
