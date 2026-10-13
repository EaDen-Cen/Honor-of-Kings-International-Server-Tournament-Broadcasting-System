import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { harness } from './harness';
import { initialState } from '../src/shared/types';
import { liveGameContext } from '../src/shared/liveGame';

const fixture=JSON.parse(await readFile(new URL('../server/fixtures/game-data-screenshots.json',import.meta.url),'utf8')) as {tabs:string[];hud:string};
test('settlement page review requires unique identities and protects trusted fields across repeat captures',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';state.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];state.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];
    await h.send({type:'settings',settings:state});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports[0];let value=73300;
    await page.route('**/api/v1/recognition/settlement',async route=>{
      expect(route.request().postDataJSON().reportId).toBe(report.id);
      await route.fulfill({json:{reportId:report.id,page:'overview',capturedAt:Date.now(),elapsedMs:100,evidence:'/uploads/player-portraits/00000000-0000-0000-0000-000000000000.png',rows:report.players.map((p,screenRow)=>({screenRow,text:p.playerId,rowId:null,suggestedRowId:p.rowId})),candidates:report.players.flatMap((_,screenRow)=>Object.entries({totalDamage:value,damageShare:20,damageTaken:20000,damageTakenShare:20,gold:7500,goldShare:20,participation:70}).map(([metric,number])=>({screenRow,metric,value:number,confidence:.95,text:String(number)})))}});
    });
    await page.goto('/control');await page.getByText('Post-game data and MVP',{exact:true}).click();
    const capture=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    await capture.getByLabel('Game data screenshot').setInputFiles({name:'data.png',mimeType:'image/png',buffer:Buffer.from(fixture.tabs[0],'base64')});
    await capture.getByRole('button',{name:'Capture full page',exact:true}).click();
    const apply=capture.getByRole('button',{name:'Apply reviewed high-confidence fields',exact:true});
    await expect(apply).toBeDisabled();
    for(let i=0;i<10;i++)await capture.getByLabel(`Settlement identity ${i}`,{exact:true}).selectOption(report.players[i].rowId);
    await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().postGameReports[0].players[0].fields.totalDamage?.value).toBe(73300);
    value=87300;await capture.getByRole('button',{name:'Capture full page',exact:true}).click();
    await expect(apply).toBeDisabled();
    for(let i=0;i<10;i++)await capture.getByLabel(`Settlement identity ${i}`,{exact:true}).selectOption(report.players[i].rowId);
    await apply.click();await expect(capture.getByText(/Existing value protected/).first()).toBeVisible();
    expect(h.state().postGameReports[0].players[0].fields.totalDamage?.value).toBe(73300);
    await page.screenshot({path:'artifacts/game-data/settlement-review.png',fullPage:true});
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('GHUD actual frame API checks access/context and screenshot review cannot directly publish',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';await h.send({type:'settings',settings:state});
    const payload={image:`data:image/png;base64,${fixture.hud}`,context:liveGameContext(h.state())};
    const endpoint='/api/v1/recognition/live-hud';
    expect((await page.request.post(endpoint,{data:payload,headers:{Authorization:'Bearer e2e-caster'}})).status()).toBe(403);
    expect((await page.request.post(endpoint,{data:{...payload,context:'old game'},headers:{Authorization:'Bearer e2e-control'}})).status()).toBe(409);
    await expect.poll(async()=>{
      const response=await page.request.post(endpoint,{data:payload,headers:{Authorization:'Bearer e2e-control'}});
      if(response.status()===503)return null;
      expect(response.ok()).toBe(true);return (await response.json()).candidates.map((c:{value:number})=>c.value);
    },{timeout:30000}).toEqual([0,0,1500,1500,0,0,12]);
    await page.goto('/control');await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const capture=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');
    await capture.getByLabel('Game data screenshot').setInputFiles({name:'hud.png',mimeType:'image/png',buffer:Buffer.from(fixture.hud,'base64')});
    await capture.getByRole('button',{name:'Sample GHUD',exact:true}).click();await expect(capture.getByText('1500 · 91% · OCR: 1.5k').first()).toBeVisible();
    await expect(capture.getByRole('button',{name:'Apply verified fields',exact:true})).toBeDisabled();
    await page.getByLabel('blueGold',{exact:true}).fill('1500');await expect.poll(()=>h.state().liveGameStats.blueGold).toBe(1500);
    expect(h.state().liveGameStats.sources?.blueGold?.source).toBe('manual');
    await page.goto('/overlay/game-hud');await expect(page.locator('.game-hud-stats')).toContainText('1.5K');
    await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:'artifacts/game-data/game-hud.png',omitBackground:true});
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('GHUD live reads publish verified values, manual edits freeze and ended streams stop updating',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';await h.send({type:'settings',settings:state});
    await page.addInitScript(()=>{
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
        canvas.getContext('2d')!.fillRect(0,0,1920,1080);
        const stream=canvas.captureStream(5);(window as Window&{testCapture?:MediaStream}).testCapture=stream;return stream;
      }});
    });
    let calls=0;
    await page.route('**/api/v1/recognition/live-hud',async route=>{
      calls++;const context=route.request().postDataJSON().context;
      const values={blueKills:0,redKills:0,blueGold:1500,redGold:1500,blueTowers:0,redTowers:0,gameTimeSeconds:calls===1?12:calls===2?14:15};
      await route.fulfill({json:{context,capturedAt:Date.now()-(calls===1?1000:0),elapsedMs:10,candidates:Object.entries(values).map(([key,value])=>({key,value,confidence:.96,text:String(value)}))}});
    });
    await page.goto('/control');await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const capture=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');
    await capture.getByRole('button',{name:'Choose shared game window',exact:true}).click();
    const sample=capture.getByRole('button',{name:'Sample GHUD',exact:true});await expect(sample).toBeEnabled();await sample.click();
    await expect(capture.getByText('First read is a candidate; sample again to verify.',{exact:true})).toBeVisible();
    await page.waitForTimeout(400);await sample.click();const apply=capture.getByRole('button',{name:'Apply verified fields',exact:true});await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().liveGameStats.blueGold).toBe(1500);
    await page.getByLabel('blueGold',{exact:true}).fill('1800');await expect.poll(()=>h.state().liveGameStats.blueGold).toBe(1800);
    await page.waitForTimeout(400);await sample.click();await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().liveGameStats.gameTimeSeconds).toBe(15);expect(h.state().liveGameStats.blueGold).toBe(1800);
    await page.evaluate(()=>(window as Window&{testCapture?:MediaStream}).testCapture?.getTracks().forEach(track=>track.stop()));
    await sample.click();await expect(capture.getByText('Capture ended; choose the game window again',{exact:true})).toBeVisible();expect(h.state().liveGameStats.blueGold).toBe(1800);
    await page.goto('/overlay/game-hud');await page.clock.install();await page.clock.fastForward(16000);await expect(page.locator('.game-hud-status')).toContainText('Capture stale');
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('stable settlement collection detects page changes even when the player table stays identical',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';await h.send({type:'settings',settings:state});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports[0];
    await page.addInitScript(({tabs})=>{
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
        const paint=async(index:number)=>{const img=new Image();img.src=`data:image/png;base64,${tabs[index]}`;await img.decode();canvas.getContext('2d')!.drawImage(img,0,0);};
        await paint(0);(window as Window&{paintGamePage?:(index:number)=>Promise<void>}).paintGamePage=paint;return canvas.captureStream(5);
      }});
    },{tabs:fixture.tabs});
    let calls=0;
    await page.route('**/api/v1/recognition/settlement',async route=>{
      calls++;await route.fulfill({json:{reportId:report.id,page:calls===1?'overview':'damage',capturedAt:Date.now(),elapsedMs:10,evidence:'/uploads/player-portraits/00000000-0000-0000-0000-000000000000.png',rows:report.players.map((p,screenRow)=>({screenRow,text:p.playerId,rowId:null,suggestedRowId:null})),candidates:[]}});
    });
    await page.goto('/control');await page.getByText('Post-game data and MVP',{exact:true}).click();
    const capture=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    await capture.getByRole('button',{name:'Choose shared game window',exact:true}).click();await capture.getByRole('checkbox',{name:'Collect drafts when frames stabilize',exact:true}).check();
    await expect(capture.getByRole('button',{name:'Data ✓',exact:true})).toBeEnabled();
    await page.waitForTimeout(2200);expect(calls).toBe(1);
    await page.evaluate(async()=>{await (window as Window&{paintGamePage?:(index:number)=>Promise<void>}).paintGamePage?.(1);});
    await expect(capture.getByRole('button',{name:'Damage ✓',exact:true})).toBeEnabled();expect(calls).toBe(2);
    expect(h.state().postGameReports[0].players.every(p=>!Object.keys(p.fields).length)).toBe(true);
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});
