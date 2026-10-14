/** A screenshot uploaded in settlement capture must also be available to the
 * single-field OCR picker. A stream is still held by sharedWindowCapture. */
export interface SharedGameStill { image:HTMLImageElement; name:string }
let current:SharedGameStill|undefined;
const listeners=new Set<(image:SharedGameStill|undefined)=>void>();
export function getSharedGameStill(){return current;}
export function publishSharedGameStill(value:SharedGameStill|undefined){
  current=value;
  for(const listener of listeners)listener(value);
}
export function subscribeSharedGameStill(listener:(image:SharedGameStill|undefined)=>void){
  listeners.add(listener);
  return ()=>{listeners.delete(listener);};
}
