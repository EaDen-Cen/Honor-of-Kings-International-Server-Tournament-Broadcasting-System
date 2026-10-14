import sharp from 'sharp';
import { fullGameRect, liveCaptureKeys, liveCaptureRects, parseLiveNumber, pixelRect, recapRegions, settlementColumns, settlementNameRect, settlementPages, settlementTabRects, validCaptureRect, type LiveCaptureKey, type CaptureRect } from '../src/shared/gameCapture.js';
import { parsePostGameNumber, type PostGamePage, type PostGameReport, type PostGameTeamMetric } from '../src/shared/postGame.js';
import { solvePlayerSlotCandidates } from '../src/shared/playerSlots.js';
import type { PlayerRecognitionProvider } from './playerRecognition.js';

export async function decodeGameFrame(image:unknown,region:unknown=fullGameRect){
  if(typeof image!=='string'||image.length>4*1024*1024||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)||!validCaptureRect(region))throw new Error('Invalid game frame or content region');
  const source=Buffer.from(image.split(',')[1],'base64'),meta=await sharp(source,{limitInputPixels:9000000}).metadata();
  if(!meta.width||!meta.height||meta.width>4096||meta.height>2160)throw new Error('Game frame too large');
  const bounds=pixelRect(region,meta.width,meta.height);
  if(bounds.width<640||bounds.height<360||Math.abs(bounds.width/bounds.height-16/9)>.08)throw new Error('Select the 16:9 game content, excluding window borders');
  return sharp(source).extract(bounds).resize(1920,1080).png().toBuffer();
}
async function crop(frame:Buffer,region:CaptureRect){return 'data:image/png;base64,'+(await sharp(frame).extract(pixelRect(region,1920,1080)).png().toBuffer()).toString('base64');}

export async function classifySettlementPage(frame:Buffer){
  const scores=await Promise.all(settlementTabRects.map(async region=>{
    const {data,info}=await sharp(frame).extract(pixelRect(region,1920,1080)).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let count=0;
    for(let i=0;i<data.length;i+=info.channels){const r=data[i],g=data[i+1],b=data[i+2];if(r>170&&g>170&&b>170&&Math.max(r,g,b)-Math.min(r,g,b)<55)count++;}
    return count/(info.width*info.height);
  }));
  const ranked=scores.map((score,index)=>({score,page:settlementPages[index]})).sort((a,b)=>b.score-a.score);
  const best=ranked[0],margin=best.score-ranked[1].score;
  return {page:best.score>.025&&margin>.012?best.page:null,scores,margin};
}

export async function recognizeSettlement(frame:Buffer,page:PostGamePage|'auto',report:PostGameReport,provider:Pick<PlayerRecognitionProvider,'recognizePlayerIds'|'recognizeNumbers'>){
  const detection=await classifySettlementPage(frame),selected=page==='auto'?detection.page:page;
  if(!selected)throw new Error('Page not recognized; select Data / Damage / Survival / Economy / KDA / Team explicitly');
  const start=performance.now();
  if(selected==='recap'){
    const jobs=(['left','right'] as const).flatMap(side=>{
      const regions=recapRegions(side);
      return [{side,key:'kda',region:regions.kda},{side,key:'gold',region:regions.gold},...regions.resources.map((region,index)=>({side,key:index===0?'towers':`resource${index}`,region}))];
    });
    const result=await provider.recognizeNumbers(await Promise.all(jobs.map(job=>crop(frame,job.region))),true);
    const teamCandidates=jobs.flatMap((job,index)=>{
      const text=result.texts[index],confidence=result.confidences[index];
      if(job.key==='kda'){
        const match=/^(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(text.trim());
        return (['kills','deaths','assists'] as const).map((metric,i)=>({side:job.side,metric,value:match?Number(match[i+1]):null,confidence:match?confidence:0,text}));
      }
      const value=job.key==='gold'?parsePostGameNumber(text.replace(/^\+/,''),'gold'):/^\d{1,2}$/.test(text.trim())?Number(text):null;
      return [{side:job.side,metric:job.key as PostGameTeamMetric,value,confidence:value===null?0:confidence,text}];
    });
    return {page:selected,detection,rows:[],candidates:[],teamCandidates,elapsedMs:performance.now()-start};
  }
  const roster=(['blue','red'] as const).map(side=>report.players.filter(p=>p.side===side));
  if(roster.some(players=>players.length!==5))throw new Error('Ten-player identity snapshot required');
  const ids=await provider.recognizePlayerIds(await Promise.all(Array.from({length:10},(_,row)=>crop(frame,settlementNameRect(row)))),roster.map(players=>players.map(p=>p.playerId)) as [string[],string[]]);
  const identity=roster.map((players,index)=>solvePlayerSlotCandidates(ids.candidates.slice(index*5,index*5+5),players.map(p=>p.playerId)));
  const jobs=Array.from({length:10},(_,screenRow)=>settlementColumns(selected,screenRow).map(column=>({...column,screenRow}))).flat();
  const numeric=await provider.recognizeNumbers(await Promise.all(jobs.map(job=>crop(frame,job.region))),true);
  return {page:selected,detection,identity,rows:Array.from({length:10},(_,screenRow)=>{
    const side=screenRow<5?0:1,solution=identity[side];
    return {screenRow,text:ids.texts[screenRow],rowId:solution?.automatic?roster[side][solution.order[screenRow%5]].rowId:null,suggestedRowId:solution?roster[side][solution.order[screenRow%5]].rowId:null};
  }),candidates:jobs.map((job,index)=>({screenRow:job.screenRow,metric:job.metric,value:parsePostGameNumber(numeric.texts[index],job.metric),confidence:numeric.confidences[index],text:numeric.texts[index]})),elapsedMs:performance.now()-start};
}

/** Use consistent per-ROI OCR preprocessing. The previous blue-only cyan pixel
 * removal distorted numerals in replay HUD themes and did not apply to red.
 * Numeric OCR already handles light-on-dark and dark-on-light crops. */
export async function recognizeLiveHud(frame:Buffer,provider:PlayerRecognitionProvider,regions:Record<LiveCaptureKey,CaptureRect>=liveCaptureRects){
  const images=await Promise.all(liveCaptureKeys.map(key=>crop(frame,regions[key])));
  const result=await provider.recognizeNumbers(images);
  return {candidates:liveCaptureKeys.map((key,index)=>({key,value:parseLiveNumber(result.texts[index],key),confidence:result.confidences[index],text:result.texts[index]})),elapsedMs:result.elapsedMs};
}
