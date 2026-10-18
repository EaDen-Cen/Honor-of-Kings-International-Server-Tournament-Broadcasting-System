import { validCaptureRect, type CaptureRect } from '../shared/gameCapture.js';
let region:CaptureRect|undefined;
const listeners=new Set<()=>void>();
export const getSharedCaptureContent=()=>region;
export function setSharedCaptureContent(next:CaptureRect|undefined){
  if(next&&!validCaptureRect(next))throw new Error('Invalid game content rectangle');
  if(JSON.stringify(region)===JSON.stringify(next))return;
  region=next?{...next}:undefined;
  for(const listener of listeners)listener();
}
export function subscribeSharedCaptureContent(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
