import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import heroes from '../src/components/HeroList.js';
import sharp from 'sharp';
import { detectDraftLockCue } from './draftCueDetection.js';

type MatchShape = 'square' | 'circle';

async function features(source: string | Buffer, shape:MatchShape='square', region?: {left:number;top:number;width:number;height:number}) {
  const size=32;
  let image=sharp(source);
  if(region) image=image.extract(region);
  const pixels: Buffer = await image.resize(size,size,{fit:'fill'}).toColourspace('srgb').removeAlpha().raw().toBuffer();
  const included:number[]=[];
  const insidePortrait=(x:number,y:number)=>{
    const dx=(x+.5-size/2)/(size/2),dy=(y+.5-size/2)/(size/2);
    // The live Ban padlock covers artwork, unlike the clean roster template.
    // Exclude that overlay from identity evidence on both sides of comparison.
    return shape!=='circle'||(dx*dx+dy*dy<=1&&!(x>=size*.58&&y>=size*.58));
  };
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    if(!insidePortrait(x,y)) continue;
    const base=(y*size+x)*3;
    included.push(pixels[base],pixels[base+1],pixels[base+2]);
  }
  const mean=included.reduce((sum,n)=>sum+n,0)/Math.max(included.length,1);
  const values:number[]=[];
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const inside=insidePortrait(x,y);
    const base=(y*size+x)*3;
    for(let channel=0;channel<3;channel++) {
      values.push(inside ? pixels[base+channel]-mean : 0);
    }
  }
  const norm=Math.sqrt(values.reduce((sum,n)=>sum+n*n,0));
  return Float64Array.from(values,n=>n/Math.max(norm,1));
}

async function perceptualFingerprint(source: Buffer, region?: {left:number;top:number;width:number;height:number}) {
  let image=sharp(source);
  if(region) image=image.extract(region);
  const pixels: Buffer = await image.resize(8,8,{fit:'fill'}).greyscale().raw().toBuffer();
  const mean = pixels.reduce((sum,n)=>sum+n,0) / pixels.length;
  let bits = '';
  for (const pixel of pixels) bits += pixel >= mean ? '1' : '0';
  return Array.from({length:16},(_,index)=>parseInt(bits.slice(index*4,index*4+4),2).toString(16)).join('');
}

export async function frameFingerprint(source: Buffer) {
  return perceptualFingerprint(source);
}

export async function frameMeanLuma(source: Buffer) {
  const stats=await sharp(source).greyscale().stats();
  return stats.channels[0]?.mean ?? 0;
}

export async function lockCueFingerprint(source: Buffer) {
  const meta=await sharp(source).metadata();
  const width=meta.width||0, height=meta.height||0;
  if(width<8||height<8) return '';
  // Legacy API diagnostic only. A hash change is never proof of a lock or an
  // empty Ban; active recognition uses positive lockCue shape evidence.
  const cueWidth=Math.max(8,Math.floor(width*.42));
  const cueHeight=Math.max(8,Math.floor(height*.42));
  return perceptualFingerprint(source,{
    left:Math.max(0,width-cueWidth),
    top:Math.max(0,height-cueHeight),
    width:cueWidth,
    height:cueHeight,
  });
}

async function captureFeatureVariants(source: string | Buffer, shape:MatchShape='square', template=false) {
  const meta=await sharp(source).metadata();
  const width=meta.width||0, height=meta.height||0;
  if(width<8||height<8) return [await features(source,shape)];

  const minSide=Math.min(width,height);
  const specs:{scale:number;dx:number;dy:number}[]=[
    {scale:1,dx:0,dy:0},
    {scale:.90,dx:0,dy:0},
    {scale:.82,dx:0,dy:0},
    {scale:.74,dx:0,dy:0},
    {scale:.82,dx:-.12,dy:0},
    {scale:.82,dx:.12,dy:0},
    {scale:.82,dx:0,dy:-.12},
    {scale:.82,dx:0,dy:.12},
    {scale:.74,dx:-.14,dy:-.08},
    {scale:.74,dx:.14,dy:-.08},
    {scale:.74,dx:-.14,dy:.08},
    {scale:.74,dx:.14,dy:.08},
  ];
  // Game portraits zoom the artwork before placing it inside a square/circle.
  // Cropping only the captured image cannot undo that zoom. Match corresponding
  // views of the template too, without changing the broadcast artwork.
  if(template) specs.splice(4);
  const variants:Float64Array[]=[];
  const seen=new Set<string>();
  for(const spec of specs){
    const side=Math.max(8,Math.min(minSide,Math.floor(minSide*spec.scale)));
    const centerX=width/2 + spec.dx*Math.max(0,width-side);
    const centerY=height/2 + spec.dy*Math.max(0,height-side);
    const left=Math.max(0,Math.min(width-side,Math.round(centerX-side/2)));
    const top=Math.max(0,Math.min(height-side,Math.round(centerY-side/2)));
    const key=`${left}:${top}:${side}`;
    if(seen.has(key)) continue;
    seen.add(key);
    variants.push(await features(source,shape,{left,top,width:side,height:side}));
  }
  return variants;
}

const TRUSTED_REMOTE_HERO_IMAGE_HOSTS=new Set([
  'world.honorofkings.com',
  'camp.honorofkings.com',
]);

export function trustedRemoteHeroImage(value:string) {
  try {
    const url=new URL(value);
    return url.protocol==='https:' && TRUSTED_REMOTE_HERO_IMAGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function heroTemplateSource(imageLink:string) {
  if(imageLink.startsWith('/')) return fileURLToPath(new URL(`../public${imageLink}`,import.meta.url));
  if(!trustedRemoteHeroImage(imageLink)) throw new Error(`Untrusted remote hero portrait: ${imageLink}`);

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),1500);
  try {
    const response=await fetch(imageLink,{
      signal:controller.signal,
      redirect:'follow',
      headers:{'user-agent':'HOK-Broadcast/1.0'},
    });
    if(!response.ok) throw new Error(`Remote hero portrait HTTP ${response.status}`);
    const buffer=Buffer.from(await response.arrayBuffer());
    if(!buffer.length||buffer.length>8*1024*1024) throw new Error('Invalid remote hero portrait size');
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

let templates: Promise<{heroId:number; square:Float64Array[]; circle:Float64Array[]}[]> | undefined;
export async function recognizeImage(buffer: Buffer, allowedHeroIds?: number[], shape:MatchShape='square') {
  templates ??= Promise.all(heroes.map(async h=>{
    try {
      const templateLink=h.recognitionImageLink || h.imageLink;
      const source=await heroTemplateSource(templateLink);
      const [square,circle]=await Promise.all([captureFeatureVariants(source,'square',true),captureFeatureVariants(source,'circle',true)]);
      return {heroId:h.id,square,circle};
    } catch(error) {
      // Existing local portraits are a release invariant and must still fail
      // loudly. A newly released hero may temporarily use an official remote
      // image until the scheduled sync can commit a local /heroesImg asset.
      // If that remote source is unavailable, skip only that template so the
      // rest of Auto BP remains usable and the hero can still be entered
      // manually.
      if(trustedRemoteHeroImage(h.recognitionImageLink || h.imageLink)) return undefined;
      throw error;
    }
  })).then(rows=>rows.filter((row):row is NonNullable<typeof row>=>Boolean(row)))
    .catch(error=>{templates=undefined;throw error;});
  const variants=await captureFeatureVariants(buffer,shape);
  const allowed = allowedHeroIds === undefined ? undefined : new Set(allowedHeroIds);
  return (await templates)
    .filter(hero => !allowed || allowed.has(hero.heroId))
    .map(hero=>{
      let confidence=0;
      const views=shape==='circle'?hero.circle:hero.square;
      for(const template of views) for(const values of variants){
        let score=0;
        for(let i=0;i<template.length;i++) score+=template[i]*values[i];
        if(score>confidence) confidence=score;
      }
      return {heroId:hero.heroId,confidence:Math.max(0,Math.min(1,confidence))};
    })
    .sort((a,b)=>b.confidence-a.confidence)
    .slice(0,5);
}

export function localCaptureRequest(req: Pick<IncomingMessage, 'headers' | 'socket'>) {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) return false;
  if (Object.keys(req.headers).some(key => /^(forwarded|x-forwarded-|cf-)/.test(key))) return false;
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
    return !req.headers.origin || new URL(req.headers.origin).host === req.headers.host;
  } catch { return false; }
}
export function captureRegion(value: unknown): { x: number; y: number; width: number; height: number } {
  const r = value as Record<string, number> | null;
  if (!r || !['x','y','width','height'].every(k => Number.isInteger(r[k])) || Math.abs(r.x) > 32768 || Math.abs(r.y) > 32768 || r.width < 32 || r.height < 32 || r.width > 1200 || r.height > 1200) throw new Error('Invalid capture region');
  return { x:r.x, y:r.y, width:r.width, height:r.height };
}
export function captureRegions(value: unknown) {
  if (!Array.isArray(value) || value.length !== 10) throw new Error('Invalid lineup regions');
  return value.map(captureRegion);
}
let busy = false;
async function captureWindows(input: object) {
  return await new Promise<{ preview?: string; previews?: string[] }>((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../scripts/capture/recognize.ps1', import.meta.url))], { timeout:20000, maxBuffer:20*1024*1024, windowsHide:true }, (error, stdout) => {
      if (error) { reject(new Error('Screen capture failed. Check the visible Windows desktop and region.')); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid capture result')); }
    });
    child.stdin?.end(JSON.stringify(input));
  });
}
export async function recognizeScreen(region: ReturnType<typeof captureRegion>) {
  if (busy) throw new Error('Capture busy');
  busy = true;
  try {
    const frame = await captureWindows({ region });
    if (!frame.preview) throw new Error('Invalid capture result');
    const buffer = Buffer.from(frame.preview.split(',')[1],'base64');
    return {
      preview: frame.preview,
      fingerprint: await frameFingerprint(buffer),
      lockFingerprint: await lockCueFingerprint(buffer),
      meanLuma: await frameMeanLuma(buffer),
      candidates: await recognizeImage(buffer),
    };
  } finally { busy = false; }
}

export async function recognizeLineup(
  regions: ReturnType<typeof captureRegions>,
  allowedHeroIdsBySlot: number[][],
) {
  if (busy) throw new Error('Capture busy');
  if (allowedHeroIdsBySlot.length !== regions.length) throw new Error('Invalid lineup candidates');
  busy = true;
  try {
    const frame = await captureWindows({ regions });
    if (!frame.previews || frame.previews.length !== regions.length) throw new Error('Invalid capture result');
    return await Promise.all(frame.previews.map(async (preview, index) => ({
      preview,
      candidates: await recognizeImage(Buffer.from(preview.split(',')[1], 'base64'), allowedHeroIdsBySlot[index]),
    })));
  } finally { busy = false; }
}


export function decodeClientCapture(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid client capture');
  const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if(!match) throw new Error('Invalid client capture');
  const buffer=Buffer.from(match[2],'base64');
  if(!buffer.length||buffer.length>3*1024*1024) throw new Error('Invalid client capture');
  return buffer;
}

const heroIDs=new Set(heroes.map(hero=>hero.id));
type Evidence = {fingerprint:string;lockFingerprint:string;meanLuma:number;lockCue:'checkmark'|'padlock'|'none';candidates:{heroId:number;confidence:number}[]};
const evidenceCache=new Map<string,Promise<Evidence>>();
let activeRecognitions=0;
export async function recognizeClientFrame(value: unknown, allowedHeroIds?: unknown, shape:unknown='square', lockImage?:unknown) {
  const buffer=decodeClientCapture(value);
  const cueBuffer=lockImage===undefined?buffer:decodeClientCapture(lockImage);
  const allowed=Array.isArray(allowedHeroIds)
    ? allowedHeroIds.filter((id):id is number=>Number.isInteger(id)&&heroIDs.has(id)).slice(0,heroes.length)
    : undefined;
  const matchShape:MatchShape=shape==='circle'?'circle':'square';
  const key=createHash('sha256').update(buffer).update(cueBuffer).update(JSON.stringify([matchShape,allowed?.slice().sort((a,b)=>a-b)])).digest('hex');
  let evidence=evidenceCache.get(key);
  if(evidence) { evidenceCache.delete(key); evidenceCache.set(key,evidence); }
  else {
    if(activeRecognitions>=4) throw new Error('Recognition busy');
    activeRecognitions++;
    evidence=(async()=>{
      try {
        const meta=await sharp(buffer).metadata();
        if(!meta.width||!meta.height||meta.width*meta.height>4_000_000) throw new Error('Frame dimensions too large');
        const cueMeta=await sharp(cueBuffer).metadata();
        if(!cueMeta.width||!cueMeta.height||cueMeta.width*cueMeta.height>4_000_000) throw new Error('Lock frame dimensions too large');
        const cueEvidence=async()=>{
          const extended=await detectDraftLockCue(cueBuffer);
          // Existing calibrations may already include the projecting checkmark.
          // Check the original too rather than forcing users to recrop them.
          return extended!=='none'||cueBuffer===buffer?extended:detectDraftLockCue(buffer);
        };
        const [fingerprint,lockFingerprint,meanLuma,lockCue,candidates]=await Promise.all([
          frameFingerprint(buffer),lockCueFingerprint(buffer),frameMeanLuma(buffer),cueEvidence(),recognizeImage(buffer,allowed,matchShape),
        ]);
        return {fingerprint,lockFingerprint,meanLuma,lockCue,candidates};
      } finally {activeRecognitions--;}
    })();
    evidenceCache.set(key,evidence);
    if(evidenceCache.size>64) evidenceCache.delete(evidenceCache.keys().next().value!);
    evidence.catch(()=>{if(evidenceCache.get(key)===evidence) evidenceCache.delete(key);});
  }
  return {preview:value as string,...structuredClone(await evidence)};
}
