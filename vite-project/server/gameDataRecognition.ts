import sharp from 'sharp';
import { fullGameRect, liveCaptureKeys, liveCaptureRects, parseLiveNumber, pixelRect, recapRegions, settlementColumns, settlementNameRect, settlementTabPages, settlementGradeRect, settlementTabRects, validCaptureRect, type LiveCaptureKey, type CaptureRect } from '../src/shared/gameCapture.js';
import { parsePostGameNumber, postGameNumberResolution, postGameGrades, type PostGameGradeField, type PostGamePage, type PostGameReport, type PostGameTeamMetric } from '../src/shared/postGame.js';
import { solvePlayerSlotCandidates } from '../src/shared/playerSlots.js';
import type { Side } from '../src/shared/types.js';
import type { PlayerRecognitionProvider } from './playerRecognition.js';
import {recognizeSettlementGoldCurve} from './settlementGoldCurve.js';

/** Stop nearly blank frames before producing false OCR evidence. */
export async function frameHasVisualContent(frame:Buffer):Promise<boolean>{
  const result=await sharp(frame).resize(96,54,{fit:'fill'}).greyscale().stats();
  return (result.channels[0]?.stdev??0)>=5;
}
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
  // The landing page has a blue Data button and a gold Return-to-room button,
  // rather than the seven-tab navigation used by detailed statistics.
  const {data:buttons,info:buttonInfo}=await sharp(frame).extract({left:10,top:945,width:1190,height:65}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let blue=0,gold=0;
  for(let y=0;y<buttonInfo.height;y++)for(let x=0;x<buttonInfo.width;x++){
    const i=(y*buttonInfo.width+x)*buttonInfo.channels,r=buttons[i],g=buttons[i+1],b=buttons[i+2];
    if(x<210&&b>140&&g>100&&b>r*1.3)blue++;
    if(x>930&&r>135&&g>110&&b<g*.85&&r>b*1.3)gold++;
  }
  if(blue/(210*65)>.3&&gold/(259*65)>.3)return {page:'summary' as PostGamePage,scores:[],margin:1};
  const scores=await Promise.all(settlementTabRects.map(async region=>{
    const {data,info}=await sharp(frame).extract(pixelRect(region,1920,1080)).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let count=0;
    for(let i=0;i<data.length;i+=info.channels){const r=data[i],g=data[i+1],b=data[i+2];if(r>170&&g>170&&b>170&&Math.max(r,g,b)-Math.min(r,g,b)<55)count++;}
    return count/(info.width*info.height);
  }));
  const ranked=scores.map((score,index)=>({score,page:settlementTabPages[index]})).sort((a,b)=>b.score-a.score);
  const best=ranked[0],margin=best.score-ranked[1].score;
  return {page:best.score>.025&&margin>.012?best.page:null,scores,margin};
}

export async function recognizeSettlement(frame:Buffer,page:PostGamePage|'auto',report:PostGameReport,provider:Pick<PlayerRecognitionProvider,'recognizePlayerIds'|'recognizeNumbers'>&Partial<Pick<PlayerRecognitionProvider,'recognizeGrades'>>,leftSide:Side='blue'){
  const detection=await classifySettlementPage(frame),selected=page==='auto'?detection.page:page;
  if(!selected)throw new Error('未识别结算页面，请选择页面类型后重试 / Page not recognized; choose its page type and retry');
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
    const goldCurve=await recognizeSettlementGoldCurve(frame,provider).catch(()=>({points:[],maxDifference:0,confidence:0,error:'Curve OCR unavailable; keep previous curve and retry'}));
    return {page:selected,leftSide,detection,rows:[],candidates:[],teamCandidates,goldCurve,elapsedMs:performance.now()-start};
  }
  // Friendly players are displayed on the left even when their actual match
  // side is red. Keep crops in screen order and only change identity rosters.
  const roster=([leftSide,leftSide==='blue'?'red':'blue'] as const).map(side=>report.players.filter(p=>p.side===side));
  if(roster.some(players=>players.length!==5))throw new Error('Ten-player identity snapshot required');
  const ids=await provider.recognizePlayerIds(await Promise.all(Array.from({length:10},(_,row)=>crop(frame,settlementNameRect(row,selected)))),roster.map(players=>players.map(p=>p.playerId)) as [string[],string[]]);
  const identity=roster.map((players,index)=>solvePlayerSlotCandidates(ids.candidates.slice(index*5,index*5+5),players.map(p=>p.playerId)));
  const jobs=Array.from({length:10},(_,screenRow)=>settlementColumns(selected,screenRow).map(column=>({...column,screenRow}))).flat();
  const numeric=await provider.recognizeNumbers(await Promise.all(jobs.map(job=>crop(frame,job.region))),true);
  let gradeWarning:string|undefined;
  // The optional letter-grade worker shares the numeric worker with HUD OCR.
  // If it becomes busy between batches, preserve the completed page fields.
  const gradeRead=selected==='summary'&&provider.recognizeGrades?await provider.recognizeGrades(await Promise.all(Array.from({length:10},(_,row)=>crop(frame,settlementGradeRect(row))))).catch(()=>{
    gradeWarning='字母评级识别暂不可用；KDA 和经济已保留，可重试本页或人工核对评级。 / Grade OCR unavailable; KDA and gold retained. Retry this page or review grades manually.';
    return null;
  }):null;
  const grades=gradeRead?.texts.map((text,screenRow)=>{
    const value=text.normalize('NFKC').replace(/\s/g,'');
    return {screenRow,text,value:postGameGrades.includes(value as PostGameGradeField['value'])?value:null,confidence:gradeRead.confidences[screenRow]};
  });
  return {page:selected,leftSide,detection,identity,rows:Array.from({length:10},(_,screenRow)=>{
    const side=screenRow<5?0:1,solution=identity[side];
    return {screenRow,text:ids.texts[screenRow],rowId:solution?.automatic?roster[side][solution.order[screenRow%5]].rowId:null,suggestedRowId:solution?roster[side][solution.order[screenRow%5]].rowId:null};
  }),grades,gradeWarning,candidates:jobs.map((job,index)=>({screenRow:job.screenRow,metric:job.metric,value:parsePostGameNumber(numeric.texts[index],job.metric),resolution:postGameNumberResolution(numeric.texts[index],job.metric),confidence:numeric.confidences[index],text:numeric.texts[index]})),elapsedMs:performance.now()-start};
}

/** Keep the proven bright-cyan suppression only when the crop actually
 * contains blue native HUD accent pixels. For color-neutral themes use
 * unchanged images; a forced cyan mask caused different UI layouts to fail.
 * Snapshot OCR remains experimental and must be operator-calibrated. */
async function liveHudCrop(frame:Buffer,key:LiveCaptureKey,region:CaptureRect){
  if(!key.startsWith('blue'))return crop(frame,region);
  const {data,info}=await sharp(frame).extract(pixelRect(region,1920,1080)).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const mask=Buffer.alloc(info.width*info.height,255);
  let cyanPixels=0;
  for(let i=0;i<mask.length;i++){
    const r=data[i*info.channels],g=data[i*info.channels+1],b=data[i*info.channels+2];
    if(g>85&&b>130&&g>r*1.3&&b>r*1.3){
      cyanPixels++;
      mask[i]=255-Math.min(255,(g-85)*4);
    }
  }
  if(cyanPixels<Math.max(8,mask.length*.012))return crop(frame,region);
  return 'data:image/png;base64,'+(await sharp(mask,{raw:{width:info.width,height:info.height,channels:1}}).png().toBuffer()).toString('base64');
}
export async function recognizeLiveHud(frame:Buffer,provider:PlayerRecognitionProvider,regions:Record<LiveCaptureKey,CaptureRect>=liveCaptureRects){
  const images=await Promise.all(liveCaptureKeys.map(key=>liveHudCrop(frame,key,regions[key])));
  const result=await provider.recognizeNumbers(images);
  return {candidates:liveCaptureKeys.map((key,index)=>({key,value:parseLiveNumber(result.texts[index],key),confidence:result.confidences[index],text:result.texts[index]})),elapsedMs:result.elapsedMs};
}
