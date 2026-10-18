import { test, expect } from './fixtures';
import { readFile } from 'node:fs/promises';
import { harness } from './harness';
import { initialState } from '../src/shared/types';

const screenshot=JSON.parse(await readFile(new URL('../server/fixtures/game-data-screenshots.json',import.meta.url),'utf8')) as {hud:string};

test('a shared game source survives cancelling a replacement and leaving the BP panel',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await page.addInitScript(()=>{
      localStorage.setItem('hok-capture-auto-watch','0');localStorage.setItem('hok-player-slot-auto','0');
      const streams:MediaStream[]=[];let selections=0;
      (window as Window&{captureStreams?:MediaStream[]}).captureStreams=streams;
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        if(++selections===2)throw new DOMException('Selection cancelled','NotAllowedError');
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.getContext('2d')!.fillRect(0,0,1920,1080);
        const stream=canvas.captureStream(5);streams.push(stream);return stream;
      }});
    });
    await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    const connected=page.locator('.screen-input .window-capture-status');await expect(connected).toHaveClass(/connected/);
    await page.getByRole('button',{name:'Change window',exact:true}).click();
    await expect(page.locator('.screen-input [role="status"]')).toContainText('Window selection cancelled.');
    await expect(connected).toHaveClass(/connected/);
    expect(await page.evaluate(()=>(window as Window&{captureStreams?:MediaStream[]}).captureStreams?.[0].getVideoTracks()[0].readyState)).toBe('live');
    await h.send({type:'settings',settings:{...h.state(),bpInputMode:'manual'}});
    await expect(page.locator('.screen-input')).toHaveCount(0);
    await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();
    await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const capture=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');
    await capture.getByText('Calibrate the seven HUD digits (confirm for each source)',{exact:true}).click();
    await expect(capture.getByRole('button',{name:'Preview captured frame',exact:true})).toBeEnabled();
    await capture.getByRole('button',{name:'Preview captured frame',exact:true}).click();
    await expect(capture.getByAltText('Actual source frame preview',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>(window as Window&{captureStreams?:MediaStream[]}).captureStreams?.[0].getVideoTracks()[0].readyState)).toBe('live');
    await capture.getByRole('button',{name:'Choose shared game window',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as Window&{captureStreams?:MediaStream[]}).captureStreams?.map(stream=>stream.getVideoTracks()[0].readyState))).toEqual(['ended','live']);
    await page.evaluate(()=>{
      const track=(window as Window&{captureStreams?:MediaStream[]}).captureStreams![1].getVideoTracks()[0];track.stop();track.dispatchEvent(new Event('ended'));
    });
    await expect(capture.getByRole('button',{name:'Preview captured frame',exact:true})).toBeDisabled();
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('loading a screenshot supersedes another panel\'s pending chooser and releases its late stream',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await page.addInitScript(()=>{
      localStorage.setItem('hok-capture-auto-watch','0');localStorage.setItem('hok-player-slot-auto','0');
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:()=>new Promise<MediaStream>(resolve=>{
        (window as Window&{finishCaptureSelection?:()=>void}).finishCaptureSelection=()=>{
          const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.getContext('2d')!.fillRect(0,0,1920,1080);
          const stream=canvas.captureStream(5);(window as Window&{lateStream?:MediaStream}).lateStream=stream;resolve(stream);
        };
      })});
    });
    await page.goto('/control');await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();
    await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const capture=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');
    await capture.getByText('Calibrate the seven HUD digits (confirm for each source)',{exact:true}).click();
    const choose=page.getByRole('button',{name:'Choose game window',exact:true});await choose.click();await expect(choose).toBeDisabled();
    await capture.getByLabel('Game data screenshot').setInputFiles({name:'latest-hud.png',mimeType:'image/png',buffer:Buffer.from(screenshot.hud,'base64')});
    await expect(capture.getByText('latest-hud.png',{exact:true})).toBeVisible();
    await page.evaluate(()=>(window as Window&{finishCaptureSelection?:()=>void}).finishCaptureSelection!());
    await expect.poll(()=>page.evaluate(()=>(window as Window&{lateStream?:MediaStream}).lateStream?.getVideoTracks()[0].readyState)).toBe('ended');
    await expect(choose).toBeEnabled();
    await expect(capture.getByText('latest-hud.png',{exact:true})).toBeVisible();
    await expect(capture.getByRole('button',{name:'Preview captured frame',exact:true})).toBeEnabled();
    await capture.getByRole('button',{name:'Preview captured frame',exact:true}).click();
    await expect(capture.getByAltText('Actual source frame preview',{exact:true})).toBeVisible();
    expect(await capture.locator('video').evaluate(video=>(video as HTMLVideoElement).srcObject)).toBeNull();
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});
