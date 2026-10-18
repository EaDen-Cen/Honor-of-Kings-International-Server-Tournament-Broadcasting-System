import type { CaptureRect } from '../shared/gameCapture.js';
export interface CapturePoint { x:number;y:number }
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export function drawCaptureRect(start:CapturePoint,end:CapturePoint,normalizedAspect?:number):CaptureRect{
  const a={x:clamp(start.x),y:clamp(start.y)},b={x:clamp(end.x),y:clamp(end.y)};
  let width=Math.abs(b.x-a.x),height=Math.abs(b.y-a.y);
  if(normalizedAspect){width=Math.min(width,height*normalizedAspect);height=width/normalizedAspect;}
  return {x:b.x<a.x?a.x-width:a.x,y:b.y<a.y?a.y-height:a.y,width,height};
}
export function moveCaptureRect(region:CaptureRect,dx:number,dy:number):CaptureRect{
  return {...region,x:Math.max(0,Math.min(1-region.width,region.x+dx)),y:Math.max(0,Math.min(1-region.height,region.y+dy))};
}
export function resizeCaptureRect(region:CaptureRect,corner:string,end:CapturePoint,normalizedAspect?:number):CaptureRect{
  const anchor={x:corner.includes('w')?region.x+region.width:region.x,y:corner.includes('n')?region.y+region.height:region.y};
  return drawCaptureRect(anchor,end,normalizedAspect);
}
