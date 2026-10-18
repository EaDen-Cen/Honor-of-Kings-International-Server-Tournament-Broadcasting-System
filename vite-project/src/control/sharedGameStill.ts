import { invalidateWindowCaptureSelection } from './sharedWindowCapture.js';

/** A screenshot uploaded in settlement capture must also be available to the
 * single-field OCR picker. A stream is still held by sharedWindowCapture. */
import { setSharedCaptureContent } from './sharedCaptureContent.js';
export interface SharedGameStill { image:HTMLImageElement; name:string }
let current:SharedGameStill|undefined;
let loadVersion=0;
const listeners=new Set<(image:SharedGameStill|undefined)=>void>();
export function getSharedGameStill(){return current;}
export function publishSharedGameStill(value:SharedGameStill|undefined){
  if(value)invalidateWindowCaptureSelection();
  loadVersion++;
  if(current===value)return;
  current=value;
  setSharedCaptureContent(undefined);
  for(const listener of listeners)listener(value);
}
/** File decoding can overlap across capture panels. The most recent selection
 * owns the shared source, regardless of which image finishes decoding first. */
export function beginSharedGameStillLoad(){invalidateWindowCaptureSelection();return ++loadVersion;}
export function isCurrentSharedGameStillLoad(version:number){return version===loadVersion;}
export function publishLoadedSharedGameStill(version:number,value:SharedGameStill){
  if(!isCurrentSharedGameStillLoad(version))return false;
  publishSharedGameStill(value);return true;
}
export function subscribeSharedGameStill(listener:(image:SharedGameStill|undefined)=>void){
  listeners.add(listener);
  return ()=>{listeners.delete(listener);};
}
