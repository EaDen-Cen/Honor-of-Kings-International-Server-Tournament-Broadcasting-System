/** Locate a red/white country badge and the adjacent light player label.
 * This is a fallback inside the calibrated crop; other badge styles are ignored.
 */
export function locateBadgeLabel(data:Uint8Array,width:number,height:number){
  const red=(p:number)=>data[p*3]>180&&data[p*3+1]<90&&data[p*3+2]<90;
  const white=(p:number)=>Math.min(data[p*3],data[p*3+1],data[p*3+2])>160&&Math.max(data[p*3],data[p*3+1],data[p*3+2])-Math.min(data[p*3],data[p*3+1],data[p*3+2])<65;
  const seen=new Uint8Array(width*height),queue=new Int32Array(width*height);
  for(let p=0;p<seen.length;p++){
    if(seen[p]||!red(p))continue;
    let head=0,tail=1,left=width,right=0,top=height,bottom=0;queue[0]=p;seen[p]=1;
    while(head<tail){
      const pixel=queue[head++],x=pixel%width,y=Math.floor(pixel/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(const next of [x>0?pixel-1:-1,x+1<width?pixel+1:-1,y>0?pixel-width:-1,y+1<height?pixel+width:-1])if(next>=0&&!seen[next]&&red(next)){seen[next]=1;queue[tail++]=next;}
    }
    const w=right-left+1,h=bottom-top+1;
    if(w<8||h<4||w<h*1.1||w>h*3.5||h>height*.6||tail<w*h*.4)continue;
    let whites=0,count=0;
    const base=bottom+1,end=Math.min(height-1,bottom+h);
    for(let y=base;y<=end;y++)for(let x=left+Math.floor(w*.2);x<=right-Math.floor(w*.2);x++){count++;if(white(y*width+x))whites++;}
    if(!count||whites/count<.5)continue;
    const center=bottom,half=Math.ceil(h*.75);
    const y0=Math.max(0,center-half),y1=Math.min(height-1,center+half);
    const after=(left+right)/2<width/2;
    // Exclude the blurred badge rim, scaled with the badge itself.
    const rim=Math.max(2,Math.round(w*.15));
    const x0=after?right+rim:0,x1=after?width-1:left-1;
    const columns=[];
    for(let x=x0;x<=x1;x++){
      let ink=0;
      for(let y=y0;y<=y1;y++){
        const index=(y*width+x)*3,r=data[index],g=data[index+1],b=data[index+2];
        if((Math.min(r,g,b)>125&&Math.max(r,g,b)-Math.min(r,g,b)<65)||(Math.min(r,g)>140&&Math.min(r,g)-b>40&&Math.abs(r-g)<80))ink++;
      }
      if(ink>=Math.max(2,(y1-y0)*.12))columns.push(x);
    }
    if(!columns.length)continue;
    const runs:{left:number;right:number}[]=[];
    let run={left:columns[0],right:columns[0]};
    for(const x of columns.slice(1)){
      if(x-run.right>h*1.3){runs.push(run);run={left:x,right:x};}else run.right=x;
    }
    runs.push(run);
    const ordered=after?runs:[...runs].reverse();
    const label=ordered.find(item=>item.right-item.left>h&&(after?item.left-right:left-item.right)<w*.8);
    if(!label)continue;
    const start=Math.max(x0,label.left-5),finish=Math.min(x1,label.right+5);
    return {left:start,top:y0,width:finish-start+1,height:y1-y0+1};
  }
}
