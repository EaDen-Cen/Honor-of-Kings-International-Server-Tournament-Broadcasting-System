import sharp from 'sharp';

export type DraftLockCue = 'checkmark' | 'padlock' | 'none';

// Positive shape evidence, never an arbitrary change in portrait brightness or
// hash. Connected components keep a white frame/hair mass out of the matcher.
export async function detectDraftLockCue(source:Buffer,banPortrait=false):Promise<DraftLockCue> {
  const {data,info}=await sharp(source).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=info;
  if(width<16||height<16) return 'none';
  for(const level of [130,155,180,205]) {
    const mask=new Uint8Array(width*height);
    for(let y=Math.floor(height*.35);y<height;y++) for(let x=0;x<width;x++) {
      const i=(y*width+x)*channels;
      const lo=Math.min(data[i],data[i+1],data[i+2]);
      const hi=Math.max(data[i],data[i+1],data[i+2]);
      if(lo>=level*.5&&data[i+1]>=level&&data[i+2]>=level&&hi-lo<=150) mask[y*width+x]=1;
    }
    for(let start=0;start<mask.length;start++) {
      if(!mask[start]) continue;
      const points:number[]=[start];mask[start]=0;
      let left=width,right=0,top=height,bottom=0;
      for(let i=0;i<points.length;i++) {
        const p=points[i],x=p%width,y=Math.floor(p/width);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nx=x+dx,ny=y+dy,next=ny*width+nx;
          if(nx>=0&&nx<width&&ny>=0&&ny<height&&mask[next]) {mask[next]=0;points.push(next);}
        }
      }
      const w=right-left+1,h=bottom-top+1;
      if(w<5||h<5||w>width*.45||h>height*.40||w/h<.65||w/h>2.2) continue;
      const actual=new Set(points);
      // Compare at native component resolution, so thin/downscaled marks retain
      // their topology. A check has a short descending and a long ascending arm.
      const teamBackdrop=(()=>{
        let blue=0,red=0;
        for(const [nx,ny] of [[-.15,.5],[1.15,.5],[.5,-.15],[.5,1.15],[-.15,0],[1.15,0],[0,1.15],[1,1.15]]) {
          const x=Math.round(left+nx*w),y=Math.round(top+ny*h);
          if(x<0||x>=width||y<0||y>=height) continue;
          const i=(y*width+x)*channels;
          if(data[i+2]>data[i]*1.35&&data[i+1]>data[i]*1.15&&data[i+2]>65) blue++;
          if(data[i]>data[i+1]*1.35&&data[i]>data[i+2]*1.35&&data[i]>65) red++;
        }
        return blue>=4||red>=4;
      })();
      for(const kind of ['checkmark','padlock'] as const) {
        if(banPortrait&&kind==='checkmark') continue;
        if(kind==='checkmark'&&(!teamBackdrop||bottom<height*.70)) continue;
        if(kind==='padlock'&&(left<width*.45||bottom<height*.70)) continue;
        for(const extraTop of (kind==='padlock'?[0,.4,.65,.85]:[0])) {
          const boxTop=Math.round(top-extraTop*h),boxHeight=bottom-boxTop+1;
          if(boxTop<0) continue;
          if(kind==='padlock') {
            const luma=(nx:number,ny:number)=>{
              const px=Math.round(left+nx*(w-1)),py=Math.round(boxTop+ny*(boxHeight-1)),i=(py*width+px)*channels;
              return (data[i]+data[i+1]+data[i+2])/3;
            };
            const rim=(luma(.2,.73)+luma(.8,.73))/2;
            const hole=Math.min(luma(.5,.65),luma(.5,.73),luma(.5,.8));
            const arch=(luma(.2,.3)+luma(.8,.3))/2;
            if(rim<150||hole>rim*.70||luma(.5,.28)>arch*.85) continue;
          }
          for(const valley of (kind==='checkmark'?[.25,.33,.4,.5]:[.33]))
            for(const thickness of (kind==='checkmark'?[.12,.18,.24,.30]:[.18]))
              for(const startY of (kind==='checkmark'?[.2,.35,.5,.65]:[.5])) {
                let hit=0,expectedCount=0,actualCount=0;
                for(let y=0;y<24;y++) for(let x=0;x<24;x++) {
                  const nx=x/23,ny=y/23;
                  const keyhole=Math.abs(nx-.5)<.12&&ny>.59&&ny<.88;
                  const expected=kind==='checkmark'
                    ? (nx<=valley ? Math.abs(ny-(startY+nx*(1-startY)/valley))<thickness : Math.abs(ny-(1-nx)/(1-valley))<thickness)
                    : !keyhole&&((ny>=.43&&nx>=.07&&nx<=.93)||(ny<.55&&Math.abs(Math.hypot((nx-.5)/.34,(ny-.32)/.32)-1)<.29));
                  const px=Math.round(left+nx*(w-1)),py=Math.round(boxTop+ny*(boxHeight-1)),i=(py*width+px)*channels;
                  const occupied=kind==='checkmark'
                    ? actual.has(py*width+px)
                    : Math.min(data[i],data[i+1],data[i+2])>=level*.7&&Math.max(data[i],data[i+1],data[i+2])>=level;
                  if(expected) expectedCount++;
                  if(occupied) actualCount++;
                  if(expected&&occupied) hit++;
                }
                const recall=hit/Math.max(1,expectedCount),precision=hit/Math.max(1,actualCount);
                if(recall>=(kind==='padlock'?.68:.75)&&precision>=(kind==='padlock'?.68:.80)) return kind;
              }
        }
      }
    }
  }
  return banPortrait&&(await detectBlendedBanLock(source))?'padlock':'none';
}


// A small Ban lock can touch pale hair and merge into a much larger connected
// component. Search bounded local windows only for Ban, independently of that
// component. Require the arch/body silhouette AND a darker central keyhole.
// The body threshold follows its white rim so blurred holes remain visible.
async function detectBlendedBanLock(source:Buffer):Promise<boolean> {
  const {data,info}=await sharp(source).resize(64,64,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const luma=(x:number,y:number)=>{const i=(Math.round(y)*64+Math.round(x))*info.channels;return (data[i]+data[i+1]+data[i+2])/3;};
  for(let w=12;w<=25;w+=1) for(let h=16;h<=28;h+=1) {
    if(w/h<.65||w/h>1.15) continue;
    for(let left=26;left+w<=64;left++) for(let top=28;top+h<=64;top++) {
      if(top+h<45) continue;
      const sample=(nx:number,ny:number)=>luma(left+nx*(w-1),top+ny*(h-1));
      const rim=(sample(.2,.73)+sample(.8,.73))/2;
      const hole=Math.min(sample(.5,.65),sample(.5,.73),sample(.5,.8));

      if(rim<150||hole>rim*.85) continue;
      let hit=0,expectedCount=0,actualCount=0;
      for(let y=0;y<16;y++) for(let x=0;x<16;x++) {
        const nx=x/15,ny=y/15;
        const keyhole=Math.abs(nx-.5)<.12&&ny>.59&&ny<.88;
        const expected=!keyhole&&((ny>=.43&&nx>=.07&&nx<=.93)||(ny<.55&&Math.abs(Math.hypot((nx-.5)/.34,(ny-.32)/.32)-1)<.29));
        const occupied=sample(nx,ny)>=(ny>=.43?rim*.88:150);
        if(expected)expectedCount++;if(occupied)actualCount++;if(expected&&occupied)hit++;
      }
      if(hit/expectedCount>=.85&&hit/actualCount>=.74) return true;
    }
  }
  return false;
}
