import type { NormalizedCaptureRegion } from './windowCaptureGeometry.js';
export function validPostGameRegion(value:unknown):value is NormalizedCaptureRegion{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const r=value as NormalizedCaptureRegion;
  return [r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n))&&r.x>=0&&r.y>=0&&r.width>=.01&&r.height>=.008&&r.x+r.width<=1.000001&&r.y+r.height<=1.000001;
}
/** Copy one selected number ROI vertically to the other four players on its
 * own team. The operator must preview and review each resulting rectangle. */
export function replicateTeamFieldRegions(
  regions:(NormalizedCaptureRegion|undefined)[],selected:number,
  step=130/1080,
):Array<NormalizedCaptureRegion|undefined>{
  const source=regions[selected],next=[...regions];
  if(!validPostGameRegion(source)||selected<0||selected>=10)return next;
  const start=selected<5?0:5;
  for(let index=start;index<start+5;index++){
    const y=source.y+(index-selected)*step;
    const candidate={...source,y};
    if(validPostGameRegion(candidate))next[index]=candidate;
  }
  return next;
}
