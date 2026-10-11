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

  constructor(private modelDirectory?:string,private languages='eng') {}

  prepare() {
    if(this.loading)return this.loading;
    this.status='loading';
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
        this.workers=await Promise.all(this.languages.split('+').map(language=>createWorker(language,OEM.LSTM_ONLY,{
          langPath:resolve(this.modelDirectory||staging!),
          gzip:!this.modelDirectory,
          cacheMethod:'none',
          errorHandler:()=>{},
        })));
        this.worker=this.workers[0];
      }finally{
        if(staging)rmSync(staging,{recursive:true,force:true});
      }
      await Promise.all(this.workers.map(worker=>worker.setParameters({
        tessedit_pageseg_mode:PSM.SINGLE_BLOCK,
        preserve_interword_spaces:'1',
        user_defined_dpi:'150',
      })));
      this.status='ready';
    })().catch(error=>{
      this.status='error';
      this.error=error instanceof Error?error.message:'OCR unavailable';
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
    const background=percentile(.5),ink=percentile(.995);
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
          texts[row]+=(texts[row]?' ':'')+line.text.trim();
          confidences[row]=Math.max(confidences[row],line.confidence/100);
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
    await Promise.all(this.workers.map(worker=>worker.terminate()));
  }
}
