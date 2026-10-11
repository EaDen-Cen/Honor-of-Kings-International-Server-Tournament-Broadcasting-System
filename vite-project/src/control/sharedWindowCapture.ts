let sharedStream:MediaStream|undefined;
const listeners=new Set<(stream:MediaStream|undefined)=>void>();

type CursorConstraints=MediaTrackConstraints & {cursor:ConstrainDOMString};

/** Exclude the OS pointer at the capture source, before any preview/OCR crops. */
export async function requestWindowCapture():Promise<MediaStream>{
  const video:CursorConstraints={cursor:'never'};
  const stream=await navigator.mediaDevices.getDisplayMedia({video,audio:false});
  try{
    for(const track of stream.getVideoTracks()){
      const capabilities=track.getCapabilities() as MediaTrackCapabilities & {cursor?:string[]};
      if(capabilities.cursor?.includes('never')){
        const constraints:CursorConstraints={...track.getConstraints(),cursor:{exact:'never'}};
        await track.applyConstraints(constraints);
      }
    }
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
  sharedStream=stream;
  for(const listener of listeners) listener(stream);
}

export function subscribeSharedWindowCapture(listener:(stream:MediaStream|undefined)=>void){
  listeners.add(listener);
  return()=>listeners.delete(listener);
}
