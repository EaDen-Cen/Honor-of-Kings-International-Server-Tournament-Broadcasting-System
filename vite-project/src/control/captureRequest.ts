/** One OCR operation owns its timeout and can no longer publish after cancellation. */
export class CaptureRequest {
  private current?:{controller:AbortController;timer:ReturnType<typeof setTimeout>};

  cancel(){
    const current=this.current;
    this.current=undefined;
    if(current){clearTimeout(current.timer);current.controller.abort();}
  }

  start(timeoutMs:number){
    this.cancel();
    const controller=new AbortController();
    const current={controller,timer:setTimeout(()=>controller.abort(new DOMException('Capture request timed out','TimeoutError')),timeoutMs)};
    this.current=current;
    return {
      signal:controller.signal,
      isCurrent:()=>this.current===current,
      finish:()=>{
        if(this.current!==current)return false;
        clearTimeout(current.timer);this.current=undefined;controller.abort();return true;
      },
    };
  }
}
