import { openDockPanel } from './dockNavigation';
import { test, expect, type Page } from './fixtures';
import type { Locator } from '@playwright/test';
import sharp from 'sharp';
import { harness } from './harness';
import { initialState } from '../src/shared/types';

async function mediaFixture(page:Page,height=1080){
  await page.addInitScript(({height})=>{
    localStorage.setItem('hok-capture-auto-watch','0');localStorage.setItem('hok-player-slot-auto','0');localStorage.setItem('hok-lineup-auto','0');
    const media={calls:0,deny:false,streams:[] as MediaStream[]};
    (window as Window&{captureTest?:typeof media}).captureTest=media;
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
      media.calls++;if(media.deny)throw new DOMException('Selection cancelled','NotAllowedError');
      const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=height;const ctx=canvas.getContext('2d')!;
      for(let y=0;y<height;y+=20)for(let x=0;x<1920;x+=20){ctx.fillStyle=(x/20+y/20)%2?'#d8dfeb':'#18243a';ctx.fillRect(x,y,20,20);}
      if(height>1080){ctx.fillStyle='#ff0000';ctx.fillRect(0,0,1920,height-1080);}
      const stream=canvas.captureStream(5);media.streams.push(stream);return stream;
    }});
  },{height});
}
async function draw(page:Page,frame:Locator,start:{x:number;y:number},end:{x:number;y:number}){
  await frame.scrollIntoViewIfNeeded();const b=(await frame.boundingBox())!;
  await page.mouse.move(b.x+b.width*start.x,b.y+b.height*start.y);await page.mouse.down();
  await page.mouse.move(b.x+b.width*end.x,b.y+b.height*end.y,{steps:8});await page.mouse.up();
}
async function calls(page:Page){return page.evaluate(()=>(window as Window&{captureTest?:{calls:number}}).captureTest!.calls);}
test('BP capture is reused by late-mounted reports, remains live on mode switches, and cancelled replacement preserves every consumer',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';state.bpInputMode='screen';await h.send({type:'settings',settings:state});
    await mediaFixture(page);await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();await expect(page.locator('.window-capture-status')).toHaveClass(/connected/);
    await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();
    await page.getByText('Advanced: field OCR · draw boxes on the actual screenshot',{exact:true}).click();
    const field=page.getByText('Advanced: field OCR · draw boxes on the actual screenshot',{exact:true}).locator('..');
    await expect(field.getByRole('button',{name:'Preview / refresh game frame',exact:true})).toBeEnabled();
    await field.getByRole('button',{name:'Preview / refresh game frame',exact:true}).click();await expect(field.getByLabel('Post-game digit selection',{exact:true})).toBeVisible();
    await openDockPanel(page,'hud');await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const hud=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');
    await hud.getByRole('button',{name:'Use BP window',exact:true}).click();expect(await calls(page)).toBe(1);
    await page.evaluate(()=>{(window as Window&{captureTest?:{deny:boolean}}).captureTest!.deny=true;});
    await page.getByRole('button',{name:'Change window',exact:true}).click();await expect(page.locator('.window-capture-status')).toHaveClass(/connected/);expect(await calls(page)).toBe(2);
    await h.send({type:'settings',settings:{...h.state(),bpInputMode:'manual'}});await expect(page.getByRole('button',{name:'Choose game window',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>(window as Window&{captureTest?:{streams:MediaStream[]}}).captureTest!.streams[0].active)).toBe(true);
    await h.send({type:'settings',settings:{...h.state(),bpInputMode:'screen'}});await expect(page.locator('.window-capture-status')).toHaveClass(/connected/);expect(await calls(page)).toBe(2);
    await page.evaluate(()=>{(window as Window&{captureTest?:{deny:boolean}}).captureTest!.deny=false;});await page.getByRole('button',{name:'Change window',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>{
      const streams=(window as Window&{captureTest?:{streams:MediaStream[]}}).captureTest!.streams;
      return streams.length===2&&!streams[0].active&&Array.from(document.querySelectorAll('video')).filter(v=>v.srcObject).every(v=>v.srcObject===streams[1]);
    })).toBe(true);expect(await calls(page)).toBe(3);
  }finally{h.close();}
});

test('player ID, GHUD and post-game regions use draw, move and resize with no coordinate inputs',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';state.bpInputMode='screen';await h.send({type:'settings',settings:state});await mediaFixture(page);await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await page.getByText('Advanced: player ID region calibration',{exact:true}).click();await page.getByRole('button',{name:'Preview BP frame and draw ID regions',exact:true}).click();
    const id=page.getByLabel('Player ID region selection',{exact:true});await draw(page,id,{x:.42,y:.42},{x:.57,y:.48});
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hok-window-capture-slots-v3')!).playerIds.blue1.width)).toBeCloseTo(.15,2);
    await expect(page.locator('.player-slot-calibration input[type=number]')).toHaveCount(0);
    await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();
    await page.getByText('Advanced: field OCR · draw boxes on the actual screenshot',{exact:true}).click();
    const field=page.getByText('Advanced: field OCR · draw boxes on the actual screenshot',{exact:true}).locator('..');await field.getByRole('button',{name:'Preview / refresh game frame',exact:true}).click();
    const digits=field.getByLabel('Post-game digit selection',{exact:true});await draw(page,digits,{x:.3,y:.25},{x:.36,y:.28});
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hok-post-game-regions-v1')!)['overview:kills:0'].width)).toBeCloseTo(.06,2);
    await draw(page,digits,{x:.33,y:.265},{x:.35,y:.285});
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hok-post-game-regions-v1')!)['overview:kills:0'].x)).toBeCloseTo(.32,2);
    const corner=digits.locator('.capture-region-handle.se');await corner.scrollIntoViewIfNeeded();const b=(await corner.boundingBox())!;
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+35,b.y+25,{steps:5});await page.mouse.up();
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hok-post-game-regions-v1')!)['overview:kills:0'].width)).toBeGreaterThan(.07);
    await field.getByRole('button',{name:'Copy region to this team (5 rows)',exact:true}).click();await expect(field.getByText('5/10 rows selected',{exact:true})).toBeVisible();await expect(field.getByLabel('ROI x',{exact:true})).toHaveCount(0);
    await openDockPanel(page,'hud');await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const hud=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');await hud.getByText('Calibrate the seven HUD digits (confirm for each source)',{exact:true}).click();await hud.getByRole('button',{name:'Preview captured frame',exact:true}).click();
    await draw(page,hud.getByLabel('GHUD digit selection',{exact:true}),{x:.8,y:.04},{x:.83,y:.075});await hud.getByRole('button',{name:'Save & confirm calibration',exact:true}).click();
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hok-ghud-calibration-v1')!).gameTimeSeconds.x)).toBeCloseTo(.8,2);await expect(hud.locator('input[type=number]')).toHaveCount(0);
    await page.screenshot({path:'artifacts/shared-capture-calibration.png',fullPage:true});
  }finally{h.close();}
});

test('drawn content removes emulator chrome for every recognizer and changing a crop rejects a late OCR result',async({page,baseURL})=>{
  const h=await harness(baseURL);let release=()=>{};
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';state.bpInputMode='screen';await h.send({type:'settings',settings:state});await mediaFixture(page,1120);await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();
    const full=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');await full.getByText('Select game content (exclude window borders)',{exact:true}).click();await full.getByRole('button',{name:'Preview raw frame and select content',exact:true}).click();
    await draw(page,full.getByLabel('Game content selection',{exact:true}),{x:.001,y:40/1120},{x:.999,y:.999});
    await page.getByText('Advanced: field OCR · draw boxes on the actual screenshot',{exact:true}).click();
    const field=page.getByText('Advanced: field OCR · draw boxes on the actual screenshot',{exact:true}).locator('..');await field.getByRole('button',{name:'Preview / refresh game frame',exact:true}).click();
    const digits=field.getByLabel('Post-game digit selection',{exact:true});await draw(page,digits,{x:.4,y:.25},{x:.45,y:.29});
    let sent=false,finished=false;
    await page.route('**/api/v1/recognition/postgame',async route=>{
      sent=true;const input=route.request().postDataJSON();expect(input.rowIds).toHaveLength(1);
      const meta=await sharp(Buffer.from(input.images[0].split(',')[1],'base64')).metadata();expect(meta.width).toBeGreaterThan(10);
      await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{candidates:[{rowId:input.rowIds[0],value:99,confidence:.99,text:'99',evidence:'/uploads/player-portraits/00000000-0000-0000-0000-000000000000.png'}]}});finished=true;
    });
    await field.getByRole('button',{name:'Read selected player',exact:true}).click();await expect.poll(()=>sent).toBe(true);
    await draw(page,digits,{x:.5,y:.25},{x:.55,y:.29});release();await expect.poll(()=>finished).toBe(true);
    await expect(field.getByRole('button',{name:'Apply verified candidates (0)',exact:true})).toBeDisabled();
    await page.route('**/api/v1/recognition/settlement',async route=>{
      const input=route.request().postDataJSON(),buffer=Buffer.from(input.image.split(',')[1],'base64');
      const {data}=await sharp(buffer).extract({left:10,top:10,width:10,height:10}).raw().toBuffer({resolveWithObject:true});
      expect(data[0]>220&&data[1]<50&&data[2]<50).toBe(false);
      await route.fulfill({status:400,json:{error:'Verified chrome-free frame'}});
    });
    await full.getByRole('button',{name:'Capture full page',exact:true}).click();await expect(full.getByText('Verified chrome-free frame',{exact:true})).toBeVisible();expect(await calls(page)).toBe(1);
  }finally{release();h.close();}
});
