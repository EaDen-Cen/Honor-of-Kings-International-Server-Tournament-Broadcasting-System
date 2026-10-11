/** Use one scale for both axes so size limits never distort ID glyphs. */
export function playerIdCropSize(width:number,height:number){
  const scale=Math.min(2,760/width,180/height);
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
