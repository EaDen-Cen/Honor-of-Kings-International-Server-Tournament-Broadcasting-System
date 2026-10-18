import {locateBadgeLabel} from './playerLabelRegion.js';
import sharp from 'sharp';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { resolve } from 'node:path';
import { existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { solvePlayerSlotCandidates } from '../src/shared/playerSlots.js';

const require=createRequire(import.meta.url);
function dirnameOfModel(code:string){
  if(!['eng','chi_sim'].includes(code))throw new Error('Use HOK_OCR_MODEL_DIR for additional languages');
  return resolve(require.resolve(`@tesseract.js-data/${code}/package.json`),'..');
}

export interface PlayerOcrCandidate {
  text:string;
  confidence:number;
  variant:'soft'|'threshold170'|'threshold190'|'yellow'|'label'|'label170'|'label190';
}

interface DecodedCrop {
  input:Buffer;
  darkBackground:boolean;
}

/** Resident offline language workers; ID crops are batched into OCR pages. */
export class PlayerRecognitionProvider {
  readonly id='local-tesseract-player-v5';
  status:'disabled'|'loading'|'ready'|'error'='disabled';
  error='';
  private worker?:Worker;
  private workers:Worker[]=[];
  private loading?:Promise<void>;
  private busy=false;
  private numericWorker?:Worker;
  private numericLoading?:Promise<Worker>;
  private numericBusy=false;

  constructor(private modelDirectory?:string,private languages='eng',private workerFactory:typeof createWorker=createWorker) {}

  prepare() {
    if(this.loading)return this.loading;
    this.status='loading';
    this.error='';
    this.loading=(async()=>{
      for(const language of this.languages.split('+')){
        if(!/^[a-z_]+$/.test(language))throw new Error('Invalid OCR language');
        if(!this.modelDirectory)continue;
        if(!existsSync(resolve(this.modelDirectory,`${language}.traineddata`)))throw new Error(`Missing local OCR model: ${language}.traineddata`);
      }
      const staging=this.modelDirectory?undefined:mkdtempSync(resolve(tmpdir(),'hok-ocr-'));
      try{
        if(staging)for(const code of this.languages.split('+')){
          copyFileSync(resolve(dirnameOfModel(code),'4.0.0_best_int',`${code}.traineddata.gz`),resolve(staging,`${code}.traineddata.gz`));
        }
        // Independent language workers avoid English-first segmentation
        // turning Chinese glyphs into Latin letters and preserve English IDs.
        // Wait for every creation before cleaning up a partial failure. A fast
        // rejection must not leave a slower successful worker untracked.
        const created=await Promise.allSettled(this.languages.split('+').map(language=>this.workerFactory(language,OEM.LSTM_ONLY,{
          langPath:resolve(this.modelDirectory||staging!),
          gzip:!this.modelDirectory,
          cacheMethod:'none',
          errorHandler:()=>{},
        })));
        this.workers=created.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
        const failure=created.find(result=>result.status==='rejected');
        if(failure?.status==='rejected')throw failure.reason;
        this.worker=this.workers[0];
      }finally{
        if(staging)rmSync(staging,{recursive:true,force:true});
      }
      const configured=await Promise.allSettled(this.workers.map(worker=>worker.setParameters({
        tessedit_pageseg_mode:PSM.SINGLE_BLOCK,
        preserve_interword_spaces:'1',
        user_defined_dpi:'150',
      })));
      const failure=configured.find(result=>result.status==='rejected');
      if(failure?.status==='rejected')throw failure.reason;
      this.status='ready';
    })().catch(async error=>{
      await Promise.allSettled(this.workers.map(worker=>worker.terminate()));
      this.workers=[];this.worker=undefined;
      this.status='error';
      this.error=error instanceof Error?error.message:'OCR unavailable';
      this.loading=undefined;
    });
    return this.loading;
  }

  private validate(images:unknown) {
    if(this.status!=='ready'||!this.worker)throw new Error('OCR provider is not ready');
    if(this.busy)throw new Error('OCR is busy');
    if(
      !Array.isArray(images)||
      images.length!==10||
      images.some(image=>typeof image!=='string'||image.length>180000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image))
    )throw new Error('Ten small ID crops required');
    return images as string[];
  }

  private async decode(images:string[]):Promise<DecodedCrop[]> {
    return Promise.all(images.map(async image=>{
      const input=Buffer.from(image.split(',')[1],'base64');
      const meta=await sharp(input,{limitInputPixels:1000000}).metadata();
      if(!meta.width||!meta.height||meta.width>2048||meta.height>512)throw new Error('ID crop too large');
      const stats=await sharp(input)
        .flatten({background:'#fff'})
        .greyscale()
        .normalize()
        .stats();
      return {input,darkBackground:(stats.channels[0]?.mean??255)<135};
    }));
  }

  private async prepareDefault(crop:DecodedCrop,width:number) {
    const flattened=sharp(crop.input).flatten({background:'#fff'});
    const prepared=crop.darkBackground
      ? flattened.clone()
        .resize(width-32,40,{fit:'contain',background:'#000'})
        .greyscale()
        .normalize()
        .threshold(150)
        .negate({alpha:false})
      : flattened.clone()
        .resize(width-32,40,{fit:'contain',background:'#fff'})
        .greyscale()
        .normalize();
    return prepared.png().toBuffer();
  }

  private async preparePlayerVariant(
    crop:DecodedCrop,
    width:number,
    variant:PlayerOcrCandidate['variant'],
  ) {
    // Materialize contrast BEFORE adding the 608px padding. Otherwise Sharp's
    // percentile normalization measures mostly padding and erases dim strokes.
    const contrast=await sharp(crop.input).flatten({background:'#fff'})
      .greyscale().normalize().png().toBuffer();
    let ink=sharp(contrast);
    if(variant!=='soft'&&variant!=='yellow'&&variant!=='label')ink=ink.threshold(variant==='threshold170'||variant==='label170'?170:190);
    if(crop.darkBackground)ink=ink.negate({alpha:false});
    const prepared=await ink.png().toBuffer();
    return sharp(prepared).resize(width-32,40,{fit:'contain',background:'#fff'})
      .png().toBuffer();
  }

  /** Locate light/dark ink before resizing: a wide ID strip is mostly empty.
   * Scaling the entire strip to 40px used to shrink dim glyphs into a few pixels.
   * Use the source luminance, not normalized background gradients, to find ink.
   */
  private async localizePlayerInk(crop:DecodedCrop):Promise<DecodedCrop> {
    const {data,info}=await sharp(crop.input).flatten({background:'#fff'})
      .greyscale().raw().toBuffer({resolveWithObject:true});
    const histogram=Array<number>(256).fill(0);
    for(const value of data)histogram[crop.darkBackground?value:255-value]++;
    const percentile=(fraction:number)=>{
      let count=0;
      for(let value=0;value<256;value++){
        count+=histogram[value];
        if(count>=data.length*fraction)return value;
      }
      return 255;
    };
    // Short right-aligned IDs occupy less than 0.5% of a wide strip. A 99.5th
    // percentile mistook their background for ink and shrank the entire strip.
    const background=percentile(.5),ink=percentile(.9995);
    if(ink-background<12)return crop;
    const cutoff=background+(ink-background)*.55;
    let left=info.width,top=info.height,right=-1,bottom=-1;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      const value=data[y*info.width+x];
      if((crop.darkBackground?value:255-value)<=cutoff)continue;
      left=Math.min(left,x);right=Math.max(right,x);
      top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    if(right-left<2||bottom-top<2)return crop;
    left=Math.max(0,left-2);top=Math.max(0,top-2);
    right=Math.min(info.width-1,right+2);bottom=Math.min(info.height-1,bottom+2);
    return {...crop,input:await sharp(crop.input)
      .extract({left,top,width:right-left+1,height:bottom-top+1}).png().toBuffer()};
  }

  /** Separate gold player labels from flags and multicolored hero artwork. */
  private async isolateYellowText(crop:DecodedCrop):Promise<DecodedCrop|undefined>{
    const {data,info}=await sharp(crop.input).flatten({background:'#fff'})
      .removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    const mask=Buffer.alloc(info.width*info.height);
    let ink=0;
    for(let index=0;index<mask.length;index++){
      const r=data[index*3],g=data[index*3+1],b=data[index*3+2];
      if(r>70&&g>65&&b<Math.min(r,g)*.9&&Math.abs(r-g)<90){
        mask[index]=Math.min(255,Math.max(0,Math.min(r,g)-b-25)*3);
        if(mask[index]>100)ink++;
      }
    }
    if(ink<12||ink>mask.length*.4)return;
    // Select the strongest horizontal band, so isolated gold artwork above
    // or below the label cannot shrink its glyphs during the 40px OCR resize.
    let bestTop=0,bestBottom=info.height-1,bestInk=0;
    let bandTop=-1,bandInk=0;
    for(let y=0;y<=info.height;y++){
      let rowInk=0;
      if(y<info.height)for(let x=0;x<info.width;x++)if(mask[y*info.width+x]>100)rowInk++;
      if(rowInk>=Math.max(3,info.width*.01)){
        if(bandTop<0)bandTop=y;
        bandInk+=rowInk;
      }else if(bandTop>=0){
        if(bandInk>bestInk){bestInk=bandInk;bestTop=bandTop;bestBottom=y-1;}
        bandTop=-1;bandInk=0;
      }
    }
    if(!bestInk)return;
    let left=info.width,right=-1;
    for(let y=bestTop;y<=bestBottom;y++)for(let x=0;x<info.width;x++){
      if(mask[y*info.width+x]>100){left=Math.min(left,x);right=Math.max(right,x);}
    }
    if(right-left<3)return;
    const top=Math.max(0,bestTop-2),bottom=Math.min(info.height-1,bestBottom+2);
    left=Math.max(0,left-2);right=Math.min(info.width-1,right+2);
    // Use color to locate the line, but keep the original antialiased strokes.
    const input=await sharp(crop.input).extract({left,top,width:right-left+1,height:bottom-top+1}).png().toBuffer();
    return {...crop,input};
  }

  private async isolateBadgeLabel(crop:DecodedCrop):Promise<DecodedCrop|undefined>{
    const {data,info}=await sharp(crop.input).flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    const region=locateBadgeLabel(data,info.width,info.height);
    if(!region)return;
    return {input:await sharp(crop.input).extract(region).png().toBuffer(),darkBackground:true};
  }

  private async readPage(crops:Buffer[],rowHeight=64,worker=this.worker) {
    const width=640;
    const page=await sharp({
      create:{width,height:rowHeight*crops.length,channels:3,background:'#fff'},
    })
      .composite(crops.map((input,index)=>({input,left:16,top:index*rowHeight+12})))
      .png()
      .toBuffer();
    const result=await worker!.recognize(page,{}, {text:true,blocks:true});
    const texts=Array<string>(crops.length).fill('');
    const confidences=Array<number>(crops.length).fill(0);
    for(const block of result.data.blocks??[]){
      for(const paragraph of block.paragraphs){
        for(const line of paragraph.lines){
          const row=Math.floor((line.bbox.y0+line.bbox.y1)/2/rowHeight);
          if(row<0||row>=crops.length)continue;
          const text=line.text.trim();
          if(!text)continue;
          const confidence=Number.isFinite(line.confidence)?Math.max(0,Math.min(1,line.confidence/100)):0;
          // Combined glyph fragments are only as reliable as their weakest
          // line. A confident prefix must not promote an uncertain suffix.
          confidences[row]=texts[row]?Math.min(confidences[row],confidence):confidence;
          texts[row]+=(texts[row]?' ':'')+text;
        }
      }
    }
    return {texts,confidences};
  }

  async recognize(images:unknown) {
    const source=this.validate(images);
    this.busy=true;
    const start=performance.now();
    try{
      const decoded=await this.decode(source);
      const crops=await Promise.all(decoded.map(crop=>this.prepareDefault(crop,640)));
      const english=this.languages.split('+').indexOf('eng');
      const result=await this.readPage(crops,64,this.workers[english]??this.worker);
      return {...result,elapsedMs:performance.now()-start};
    }finally{
      this.busy=false;
    }
  }

  /** Numeric tables use bounded batches and a separate alphabet from player IDs. */
  async recognizeNumbers(images:string[],tableText=false) {
    return this.recognizeCells(images,tableText,'0123456789.,:/%kK+万');
  }
  async recognizeGrades(images:string[]){
    return this.recognizeCells(images,false,'SABCD+');
  }
  private async recognizeCells(images:string[],tableText:boolean,alphabet:string) {
    if(this.status!=='ready'||!this.worker)throw new Error('OCR provider is not ready');
    if(this.numericBusy)throw new Error('Numeric OCR is busy');
    if(!Array.isArray(images)||!images.length||images.length>100||images.some(image=>typeof image!=='string'||image.length>180000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)))throw new Error('Invalid numeric crops');
    this.numericBusy=true;
    const start=performance.now();
    try{
      const worker=await this.prepareNumericWorker();
      const decoded=await this.decode(images);
      const numeric=tableText?await Promise.all(decoded.map(async crop=>{
        const {data,info}=await sharp(crop.input).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
        const mask=Buffer.alloc(info.width*info.height,255);
        for(let i=0;i<mask.length;i++){
          const r=data[i*info.channels],g=data[i*info.channels+1],b=data[i*info.channels+2],low=Math.min(r,g,b),high=Math.max(r,g,b);
          // Pale neutral/cyan text; exclude saturated selected-row and percentage bars.
          if(low>100&&high-low<105)mask[i]=255-Math.min(255,(low-100)*3);
        }
        return {input:await sharp(mask,{raw:{width:info.width,height:info.height,channels:1}}).png().toBuffer(),darkBackground:false};
      })):decoded;
      const localized=await Promise.all(numeric.map(crop=>this.localizePlayerInk(crop)));
      const crops=await Promise.all(localized.map(crop=>this.preparePlayerVariant(crop,640,'soft')));
      await worker.setParameters({tessedit_char_whitelist:alphabet,tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
      const result=await this.readPage(crops,64,worker);
      // Batch segmentation can drop a solitary 1 or a small decimal point.
      // Retry only weak cells as isolated lines, keeping OCR cost bounded.
      const weak=result.confidences.flatMap((confidence,index)=>confidence<.85?[index]:[]);
      if(weak.length){
        await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
        for(const index of weak){
          const variants=[crops[index],await this.preparePlayerVariant(await this.localizePlayerInk(decoded[index]),640,'soft')];
          for(const input of variants){
            const padded=await sharp(input).extend({top:12,bottom:12,left:16,right:16,background:'#fff'}).png().toBuffer();
            const read=await worker.recognize(padded),confidence=read.data.confidence/100;
            if(confidence>result.confidences[index]){result.texts[index]=read.data.text.trim();result.confidences[index]=confidence;}
          }
        }
      }
      return {...result,elapsedMs:performance.now()-start};
    }finally{
      this.numericBusy=false;
    }
  }

  private prepareNumericWorker(){
    if(this.numericWorker)return Promise.resolve(this.numericWorker);
    if(this.numericLoading)return this.numericLoading;
    let created:Worker|undefined;
    this.numericLoading=(async()=>{
      const staging=this.modelDirectory?undefined:mkdtempSync(resolve(tmpdir(),'hok-numeric-ocr-'));
      try{
        if(staging)copyFileSync(resolve(dirnameOfModel('eng'),'4.0.0_best_int','eng.traineddata.gz'),resolve(staging,'eng.traineddata.gz'));
        const worker=created=await this.workerFactory('eng',OEM.LSTM_ONLY,{langPath:resolve(this.modelDirectory||staging!),gzip:!this.modelDirectory,cacheMethod:'none',errorHandler:()=>{}});
        await worker.setParameters({user_defined_dpi:'150',preserve_interword_spaces:'1'});
        this.numericWorker=worker;return worker;
      }finally{if(staging)rmSync(staging,{recursive:true,force:true});}
    })().catch(async error=>{
      if(created)await Promise.allSettled([created.terminate()]);
      this.numericWorker=undefined;this.numericLoading=undefined;
      throw error;
    });
    return this.numericLoading;
  }

  /**
   * Player IDs use a stylized light-on-dark esports font. Keep anti-aliased
   * strokes first, then retry unresolved teams with high-contrast thresholds.
   * Independent language workers supply candidates to the roster matcher.
   */
  async recognizePlayerIds(images:unknown,players?:[string[],string[]]) {
    const source=this.validate(images);
    this.busy=true;
    const start=performance.now();
    try{
      const original=await this.decode(source);
      const decoded=await Promise.all(original.map(crop=>this.localizePlayerInk(crop)));
      const candidates=Array.from({length:10},()=>[] as PlayerOcrCandidate[]);
      // Production fast path: read ten soft crops first. Only retry unresolved
      // teams. Badge-assisted crops are separate batches so noisy originals
      // cannot influence the small suffixes on the cleaned text rows.
      const batches:PlayerOcrCandidate['variant'][][]=players
        ? [['soft'],['threshold170','threshold190','yellow'],['label'],['label170','label190']]
        : [['soft','threshold170','threshold190','yellow'],['label'],['label170','label190']];
      let yellow:(DecodedCrop|undefined)[]|undefined;
      let labels:(DecodedCrop|undefined)[]|undefined;
      let slots=Array.from({length:10},(_,index)=>index);
      for(const batch of batches){
        if(!slots.length)break;
        if(batch.includes('yellow'))yellow=await Promise.all(decoded.map(crop=>this.isolateYellowText(crop)));
        if(batch.includes('label'))labels=await Promise.all(original.map(crop=>this.isolateBadgeLabel(crop)));
        const jobs=batch.flatMap(variant=>slots.filter(slot=>(variant!=='yellow'||yellow?.[slot])&&(!variant.startsWith('label')||labels?.[slot])).map(slot=>({slot,variant})));
        if(!jobs.length)continue;
        const crops=await Promise.all(jobs.map(({slot,variant})=>{
          const crop=variant==='yellow'?yellow![slot]!:variant.startsWith('label')?labels![slot]!:decoded[slot];
          return this.preparePlayerVariant(crop,640,variant);
        }));
        const results=await Promise.all(this.workers.map(worker=>this.readPage(crops,64,worker)));
        for(const result of results){
          for(let index=0;index<jobs.length;index++){
            const {slot,variant}=jobs[index];
            const text=result.texts[index]?.trim()||'';
            if(!text)continue;
            candidates[slot].push({
              text,
              confidence:result.confidences[index]??0,
              variant,
            });
          }
        }
        if(players&&batch.length===1&&batch[0]==='soft'){
          // Block segmentation can omit a short ID such as Fox entirely.
          // Recover only missing rows with the same soft crop as a single line,
          // before retrying a whole team with heavier threshold variants.
          const missing=jobs.flatMap((job,index)=>candidates[job.slot].length?[]:[{slot:job.slot,input:crops[index]}]);
          const worker=this.workers[this.languages.split('+').indexOf('eng')]??this.worker!;
          if(missing.length){
            await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
            try{
              for(const job of missing){
                const image=await sharp(job.input).extend({top:12,bottom:12,left:16,right:16,background:'#fff'}).png().toBuffer();
                const result=await worker.recognize(image),text=result.data.text.trim();
                if(text)candidates[job.slot].push({text,confidence:result.data.confidence/100,variant:'soft'});
              }
            }finally{await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});}
          }
        }
        if(players)slots=[0,1].flatMap(side=>
          solvePlayerSlotCandidates(candidates.slice(side*5,side*5+5),players[side])?.automatic
            ? [] : Array.from({length:5},(_,index)=>side*5+index));
      }
      const texts=Array<string>(10).fill('');
      const confidences=Array<number>(10).fill(0);
      for(let slot=0;slot<10;slot++){
        const best=[...candidates[slot]].sort((a,b)=>b.confidence-a.confidence)[0];
        if(!best)continue;
        texts[slot]=best.text;
        confidences[slot]=best.confidence;
      }
      return {
        texts,
        confidences,
        candidates,
        elapsedMs:performance.now()-start,
      };
    }finally{
      this.busy=false;
    }
  }

  async close(){
    await this.numericLoading?.catch(()=>{});
    await Promise.all([...this.workers,...(this.numericWorker?[this.numericWorker]:[])].map(worker=>worker.terminate()));
  }
}
