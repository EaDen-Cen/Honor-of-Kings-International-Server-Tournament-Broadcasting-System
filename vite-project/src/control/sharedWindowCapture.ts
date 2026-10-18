let sharedStream:MediaStream|undefined;
const listeners=new Set<(stream:MediaStream|undefined)=>void>();
let detachStreamListeners:()=>void=()=>{};
let selectionVersion=0;

type CursorConstraints=MediaTrackConstraints & {cursor:ConstrainDOMString};

/** A newer screenshot or source choice supersedes any browser chooser still open. */
export function invalidateWindowCaptureSelection(){selectionVersion++;}

/** Exclude the OS pointer at the capture source, before any preview/OCR crops. */
export async function requestWindowCapture(signal?:AbortSignal):Promise<MediaStream>{
  if(signal?.aborted)throw new DOMException('Capture selection cancelled','AbortError');
  const version=++selectionVersion;
  const video:CursorConstraints={cursor:'never'};
  const stream=await navigator.mediaDevices.getDisplayMedia({video,audio:false});
  try{
    if(signal?.aborted||version!==selectionVersion)throw new DOMException('Capture selection cancelled','AbortError');
    for(const track of stream.getVideoTracks()){
      const capabilities=(track.getCapabilities?.()??{}) as MediaTrackCapabilities & {cursor?:string[]};
      if(capabilities.cursor?.includes('never')){
        const constraints:CursorConstraints={...track.getConstraints(),cursor:{exact:'never'}};
        await track.applyConstraints(constraints);
      }
    }
    if(signal?.aborted||version!==selectionVersion)throw new DOMException('Capture selection cancelled','AbortError');
    return stream;
  }catch(error){
    stream.getTracks().forEach(track=>track.stop());
    throw error;
  }
}

export function getSharedWindowCaptureStream(){
  return sharedStream;
}

export function setSharedWindowCaptureStream(stream:MediaStream|undefined){
  if(sharedStream===stream) return;
  const previous=sharedStream;
  detachStreamListeners();
  sharedStream=stream;
  if(stream){
    invalidateWindowCaptureSelection();
    const ended=()=>{if(sharedStream===stream)setSharedWindowCaptureStream(undefined);};
    const tracks=stream.getVideoTracks();
    for(const track of tracks)track.addEventListener('ended',ended);
    stream.addEventListener('inactive',ended);
    detachStreamListeners=()=>{
      for(const track of tracks)track.removeEventListener('ended',ended);
      stream.removeEventListener('inactive',ended);
    };
  }else detachStreamListeners=()=>{};
  previous?.getTracks().forEach(track=>track.stop());
  for(const listener of listeners) listener(stream);
}

export function subscribeSharedWindowCapture(listener:(stream:MediaStream|undefined)=>void){
  listeners.add(listener);
  return()=>listeners.delete(listener);
}
