import { test, expect } from './fixtures';
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
    const report=h.state().postGameReports[0];let value=73300,includeHealing=false;
    await page.route('**/api/v1/recognition/settlement',async route=>{
      expect(route.request().postDataJSON().reportId).toBe(report.id);
      await route.fulfill({json:{reportId:report.id,page:'overview',capturedAt:Date.now(),elapsedMs:100,evidence:'/uploads/player-portraits/00000000-0000-0000-0000-000000000000.png',rows:report.players.map((p,screenRow)=>({screenRow,text:p.playerId,rowId:null,suggestedRowId:p.rowId})),candidates:report.players.flatMap((_,screenRow)=>Object.entries({totalDamage:value,damageShare:20,damageTaken:20000,damageTakenShare:20,gold:7500,goldShare:20,participation:70,...(includeHealing?{healing:1000}:{})}).map(([metric,number])=>({screenRow,metric,value:number,confidence:.95,text:String(number)})))}});
    });
    await page.goto('/control');await page.getByText('Post-game data and MVP',{exact:true}).click();
    const capture=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    await capture.getByLabel('Game data screenshot').setInputFiles({name:'data.png',mimeType:'image/png',buffer:Buffer.from(fixture.tabs[0],'base64')});
    await capture.getByRole('button',{name:'Capture full page',exact:true}).click();
    const apply=capture.getByRole('button',{name:'Apply reviewed high-confidence fields',exact:true});
    await expect(apply).toBeEnabled();
    expect(h.state().postGameReports[0].players[0].fields.totalDamage).toBeUndefined();
    // Slot defaults are allowed, but duplicate manual bindings never are.
    await capture.getByLabel('Settlement identity 1',{exact:true}).selectOption(report.players[0].rowId);
    await expect(apply).toBeDisabled();
    for(let i=0;i<10;i++)await capture.getByLabel(`Settlement identity ${i}`,{exact:true}).selectOption(report.players[i].rowId);
    await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().postGameReports[0].players[0].fields.totalDamage?.value).toBe(73300);
    value=87300;await capture.getByRole('button',{name:'Capture full page',exact:true}).click();
    await expect(apply).toBeDisabled();
    for(let i=0;i<10;i++)await expect(capture.getByLabel(`Settlement identity ${i}`,{exact:true})).toHaveValue(report.players[i].rowId);
    await expect(capture.getByText(/Existing value protected/).first()).toBeVisible();
    includeHealing=true;await capture.getByRole('button',{name:'Capture full page',exact:true}).click();await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().postGameReports[0].players[0].fields.healing?.value).toBe(1000);await expect(apply).toBeDisabled();
    expect(h.state().postGameReports[0].players[0].fields.totalDamage?.value).toBe(73300);
    await page.screenshot({path:'artifacts/game-data/settlement-review.png',fullPage:true});
  }finally{h.close();}
});

test('page-first workflow retains uploaded drafts and stores exact economy and letter grades independently',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';await h.send({type:'settings',settings:state});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports[0];let calls=0;
    await page.route('**/api/v1/recognition/settlement',async route=>{
      calls++;const summary=calls===2;
      await route.fulfill({json:{reportId:report.id,page:summary?'summary':'economy',capturedAt:Date.now(),elapsedMs:10,evidence:'/uploads/player-portraits/00000000-0000-0000-0000-000000000000.png',rows:report.players.map((p,screenRow)=>({screenRow,text:p.playerId,rowId:p.rowId,suggestedRowId:p.rowId})),candidates:report.players.flatMap((_,screenRow)=>[{screenRow,metric:'gold',value:summary?7589:7600,resolution:summary?1:100,confidence:.95,text:summary?'7589':'7.6k'},...(!summary?[{screenRow,metric:'goldShare',value:18,resolution:1,confidence:.95,text:'18%'}]:[])]),grades:summary?report.players.map((_,screenRow)=>({screenRow,value:'B',confidence:.95,text:'B'})):undefined}});
    });
    await page.goto('/control');await page.getByText('Post-game data and MVP',{exact:true}).click();
    const advanced=page.getByText('Advanced: field OCR · draw boxes on the actual screenshot',{exact:true}).locator('..');
    expect(await advanced.evaluate(e=>(e as HTMLDetailsElement).open)).toBe(false);
    const capture=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    const upload=capture.getByLabel('Game data screenshot'),read=capture.getByRole('button',{name:'Capture full page',exact:true}),apply=capture.getByRole('button',{name:'Apply reviewed high-confidence fields',exact:true});
    await upload.setInputFiles({name:'economy.png',mimeType:'image/png',buffer:Buffer.from(fixture.tabs[3],'base64')});await read.click();await expect(capture.getByRole('columnheader',{name:'Gold share',exact:true})).toBeVisible();await apply.click();
    await expect.poll(()=>h.state().postGameReports[0].players[0].fields.gold?.value).toBe(7600);
    await upload.setInputFiles({name:'summary.png',mimeType:'image/png',buffer:Buffer.from(fixture.tabs[0],'base64')});await expect(capture.getByRole('button',{name:'Economy ✓',exact:true})).toBeEnabled();await read.click();
    await expect(capture.getByRole('columnheader',{name:'Letter grade',exact:true})).toBeVisible();await apply.click();
    await expect.poll(()=>h.state().postGameReports[0].players[0].fields.gold?.value).toBe(7589);
    await expect.poll(()=>h.state().postGameReports[0].players[0].grade?.value).toBe('B');expect(h.state().postGameReports[0].players[0].fields.rating).toBeUndefined();
    await capture.getByRole('button',{name:'Economy ✓',exact:true}).click();await expect(apply).toBeDisabled();expect(h.state().postGameReports[0].players[0].fields.gold?.value).toBe(7589);
    await capture.getByRole('button',{name:'Settlement summary ✓',exact:true}).click();await capture.getByLabel('Settlement 0 gold',{exact:true}).fill('7590');await capture.getByLabel('Settlement 0 gold',{exact:true}).press('Tab');
    await expect.poll(()=>h.state().postGameReports[0].players[0].fields.gold?.manual).toBe(true);
    await page.screenshot({path:'artifacts/game-data/settlement-page-first.png',fullPage:true});
  }finally{h.close();}
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
    const sample=capture.getByRole('button',{name:'Sample GHUD',exact:true});await expect(sample).toBeDisabled();
    await capture.getByText('Calibrate the seven HUD digits (confirm for each source)',{exact:true}).click();
    await capture.getByRole('button',{name:'Preview captured frame',exact:true}).click();
    await expect(capture.getByLabel('GHUD digit selection',{exact:true})).toBeVisible();
    await capture.getByRole('button',{name:'Save & confirm calibration',exact:true}).click();
    await expect(sample).toBeEnabled();await sample.click();await expect(capture.getByText('1500 · 91% · OCR: 1.5k').first()).toBeVisible();
    await expect(sample).toBeEnabled();await sample.click();
    await expect(capture.getByRole('status')).toContainText('Samples compared;');
    await expect(capture.getByRole('button',{name:'Apply verified fields',exact:true})).toBeDisabled();
    await expect(capture.getByRole('checkbox',{name:'Try every second (skip if prior read is busy)',exact:true})).toBeDisabled();
    await expect(capture.getByRole('checkbox',{name:'Publish fields verified by two reads',exact:true})).toBeDisabled();
    expect(h.state().liveGameStats.blueGold).toBeUndefined();
    await page.getByLabel('blueGold',{exact:true}).fill('1500');await page.getByLabel('blueGold',{exact:true}).press('Tab');await expect.poll(()=>h.state().liveGameStats.blueGold).toBe(1500);
    expect(h.state().liveGameStats.sources?.blueGold?.source).toBe('manual');
    await page.goto('/overlay/game-hud');await expect(page.getByTestId('game-hud-blue-gold')).toContainText('1.5k');
    await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:'artifacts/game-data/game-hud.png',omitBackground:true});
  }finally{h.close();}
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
      const values={blueKills:0,redKills:0,blueGold:1500,redGold:1500,blueTowers:0,redTowers:0,gameTimeSeconds:calls===1?12:calls===2?14:calls+12};
      await route.fulfill({json:{context,capturedAt:Date.now()-(calls===1?1000:0),elapsedMs:10,candidates:Object.entries(values).map(([key,value])=>({key,value,confidence:.96,text:String(value)}))}});
    });
    await page.goto('/control');await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const capture=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');
    await capture.getByRole('button',{name:'Connect BP window (shared by all modules)',exact:true}).click();
    const sample=capture.getByRole('button',{name:'Sample GHUD',exact:true});await expect(sample).toBeDisabled();
    await capture.getByText('Calibrate the seven HUD digits (confirm for each source)',{exact:true}).click();
    await capture.getByRole('button',{name:'Preview captured frame',exact:true}).click();
    await expect(capture.getByLabel('GHUD digit selection',{exact:true})).toBeVisible();
    await capture.getByRole('button',{name:'Save & confirm calibration',exact:true}).click();
    await expect(sample).toBeEnabled();await sample.click();
    await expect(capture.getByText('First read is a candidate; sample again to verify.',{exact:true})).toBeVisible();
    await expect(capture.getByRole('button',{name:'Apply verified fields',exact:true})).toBeDisabled();
    await page.waitForTimeout(400);await sample.click();const apply=capture.getByRole('button',{name:'Apply verified fields',exact:true});await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().liveGameStats.blueGold).toBe(1500);
    await page.getByLabel('blueGold',{exact:true}).fill('1800');await page.getByLabel('blueGold',{exact:true}).press('Tab');await expect.poll(()=>h.state().liveGameStats.blueGold).toBe(1800);
    // Manual edits invalidate earlier evidence. Verify two fresh reads.
    await page.waitForTimeout(400);await sample.click();await expect(apply).toBeDisabled();
    await page.waitForTimeout(400);await sample.click();await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().liveGameStats.gameTimeSeconds).toBe(16);expect(h.state().liveGameStats.blueGold).toBe(1800);
    const callsBeforeEnding=calls;
    await page.evaluate(()=>(window as Window&{testCapture?:MediaStream}).testCapture?.getTracks().forEach(track=>{track.stop();track.dispatchEvent(new Event('ended'));}));
    await expect(sample).toBeDisabled();await expect(apply).toBeDisabled();
    await expect(capture.getByRole('button',{name:'Preview captured frame',exact:true})).toBeDisabled();
    expect(calls).toBe(callsBeforeEnding);expect(h.state().liveGameStats.blueGold).toBe(1800);expect(h.state().liveGameStats.gameTimeSeconds).toBe(16);
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,density:'full'}});
    await page.goto('/overlay/game-hud#token=e2e-overlay');await expect(page.locator('.game-hud')).toBeVisible();await page.clock.install();await page.clock.fastForward(16000);await expect(page.locator('.game-hud-capture')).toContainText('STALE');
  }finally{h.close();}
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
    await capture.getByRole('button',{name:'Connect BP window (shared by all modules)',exact:true}).click();await capture.getByRole('checkbox',{name:'Collect drafts when frames stabilize',exact:true}).check();
    await expect(capture.getByRole('button',{name:'Data ✓',exact:true})).toBeEnabled();
    await page.waitForTimeout(2200);expect(calls).toBe(1);
    await page.evaluate(async()=>{await (window as Window&{paintGamePage?:(index:number)=>Promise<void>}).paintGamePage?.(1);});
    await expect(capture.getByRole('button',{name:'Damage ✓',exact:true})).toBeEnabled();expect(calls).toBe(2);
    expect(h.state().postGameReports[0].players.every(p=>!Object.keys(p.fields).length)).toBe(true);
  }finally{h.close();}
});

test('automatic HUD output remains enabled after its own state confirmations',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'settings',settings:{...initialState(),language:'eng'}});
    await page.addInitScript(()=>{
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
        canvas.getContext('2d')!.fillRect(0,0,1920,1080);return canvas.captureStream(5);
      }});
    });
    let calls=0;
    await page.route('**/api/v1/recognition/live-hud',async route=>{
      const call=++calls,context=route.request().postDataJSON().context;
      // Fast-forward only browser scheduling. Evidence remains in the real
      // server's past, as it would for delayed OCR responses.
      const capturedAt=Date.now()-Math.max(0,5-call)*4000;
      const values={blueKills:0,redKills:0,blueGold:1500,redGold:1500,blueTowers:0,redTowers:0,gameTimeSeconds:10+call*5};
      await route.fulfill({json:{context,capturedAt,profile:'test-profile',elapsedMs:10,candidates:Object.entries(values).map(([key,value])=>({key,value,confidence:.96,text:String(value)}))}});
    });
    await page.goto('/control');
    await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();
    await page.getByText('GHUD top bar recognition · Experimental',{exact:true}).click();
    const panel=page.getByText('GHUD top bar recognition · Experimental',{exact:true}).locator('..');
    await panel.getByRole('button',{name:'Connect BP window (shared by all modules)',exact:true}).click();
    await panel.getByText('Calibrate the seven HUD digits (confirm for each source)',{exact:true}).click();
    await panel.getByRole('button',{name:'Preview captured frame',exact:true}).click();
    await panel.getByRole('button',{name:'Save & confirm calibration',exact:true}).click();
    await page.clock.install();
    const auto=panel.getByRole('checkbox',{name:'Try every second (skip if prior read is busy)',exact:true});
    const publish=panel.getByRole('checkbox',{name:'Publish fields verified by two reads',exact:true});
    await auto.check();
    await expect(panel.getByText('First read is a candidate; sample again to verify.',{exact:true})).toBeVisible();
    await publish.check();
    await page.clock.fastForward(5001);
    await expect.poll(()=>h.state().liveGameStats.gameTimeSeconds).toBe(20);
    await expect(auto).toBeChecked();await expect(publish).toBeChecked();
    // Resuming after acknowledgement must collect fresh evidence and publish again.
    await expect.poll(()=>calls).toBeGreaterThanOrEqual(3);
    await page.clock.fastForward(5001);
    await expect.poll(()=>h.state().liveGameStats.gameTimeSeconds).toBeGreaterThanOrEqual(30);
    await expect(auto).toBeChecked();await expect(publish).toBeChecked();
  }finally{h.close();}
});
