import { initialState } from '../src/shared/types';
import { test,expect } from '@playwright/test';
import { harness } from './harness';
import { defaultCaptureSlots, type CaptureSlotKey } from '../src/control/bpCaptureLayout';
test('player mapping renders correct owner, HUD reconnects, MVP switches and recovery exports omit secrets',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    const base=h.state();base.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];base.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];
    await h.send({type:'settings',settings:base});
    await h.send({type:'set_player_slot_order',side:'blue',order:[4,3,2,1,0],expectedPlayers:base.blueTeam.players});
    await page.goto('/overlay/draft');
    await expect(page.locator('.broadcast-card[data-team-id="team-a"][data-slot="0"] .player-id')).toHaveText('Echo');
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,blueKills:8,redKills:5,blueTowers:3,redTowers:2}});
    await page.goto('/overlay/game-hud');await expect(page.locator('.game-hud')).toBeVisible();await expect(page.locator('.game-hud-stats')).toContainText('8');
    await page.reload();await expect(page.locator('.game-hud-stats')).toContainText('8');
    await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:'artifacts/game-hud.png',omitBackground:true});
    await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports[0],player=report.players[0];
    await h.send({type:'post_game_fields',reportId:report.id,updates:['kills','deaths','assists','rating','damageShare','gold','totalDamage'].map((metric,index)=>({rowId:player.rowId,metric:metric as 'kills',field:{value:[8,2,10,12.5,35,14000,72000][index],sourcePage:'overview',confidence:1,manual:true}}))});
    await page.goto('/overlay/mvp');await expect(page.locator('.mvp-card')).toHaveCount(0);
    await h.send({type:'select_mvp',reportId:report.id,rowId:player.rowId});await expect(page.locator('.mvp-card h1')).toHaveText('Echo');
    await page.screenshot({path:'artifacts/mvp.png',omitBackground:true});
    await h.send({type:'select_mvp',reportId:report.id,rowId:report.players[5].rowId});await expect(page.locator('.mvp-card.red h1')).toHaveText('Fox');
    const exportResult=await page.request.get('/api/match-export',{headers:{Authorization:'Bearer e2e-control'}});expect(exportResult.ok()).toBe(true);const exported=await exportResult.json();expect(exported.entries.some((entry:{path:string})=>entry.path==='access.json')).toBe(false);
    expect((await page.request.get('/api/recovery',{headers:{Authorization:'Bearer e2e-caster'}})).status()).toBe(403);
    await page.goto('/control');await expect(page.locator('.player-slot-alignment')).toBeVisible();await page.screenshot({path:'artifacts/control-milestones.png',fullPage:true});
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('operator can apply the visible red proposal during a slow scan and late OCR cannot overwrite it',async({page,baseURL})=>{
  const h=await harness(baseURL);let release=()=>{};
  try{
    await h.send({type:'reset_match'});const base=h.state();base.bpInputMode='screen';base.language='eng';base.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];base.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];await h.send({type:'settings',settings:base});
    await page.addInitScript(()=>{localStorage.setItem('hok-player-slot-auto','1');Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.getContext('2d')!.fillRect(0,0,1920,1080);return canvas.captureStream(10);}});});
    let calls=0,lateCompleted=false;
    await page.route('**/api/v1/recognition/players',async route=>{
      if(route.request().method()==='GET')return route.fulfill({json:{status:'ready'}});
      calls++;
      if(calls>1)await new Promise<void>(resolve=>{release=resolve;});
      const solution={order:calls===1?[4,3,2,1,0]:[1,2,3,4,0],confidence:[.9,.9,.9,.9,.77],average:.87,margin:.2,automatic:false,anomalies:[4]};
      await route.fulfill({json:{texts:['Alpha','Bravo','Charlie','Delta','Echo','Juliet','India','Hotel','Golf','Fox'],confidences:Array(10).fill(.9),blue:solution,red:solution,elapsedMs:200}});
      if(calls>1)lateCompleted=true;
    });
    await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await expect.poll(()=>calls).toBe(2);
    const apply=page.locator('.player-slot-team-card.red').getByRole('button',{name:'Apply suggestion',exact:true});
    await expect(apply).toBeEnabled();await apply.click();
    await expect.poll(()=>h.state().redPlayerSlotOrder.join(',')).toBe('4,3,2,1,0');
    await expect(page.locator('.player-slot-alignment input[type=checkbox]')).not.toBeChecked();
    release();
    await expect.poll(()=>lateCompleted).toBe(true);
    await expect(page.getByRole('button',{name:'Restore auto',exact:true})).toBeEnabled();
    await expect.poll(()=>h.state().redPlayerSlotOrder.join(',')).toBe('4,3,2,1,0');
  }finally{release();await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('two matching borderline OCR frames combine into an automatic player-order decision',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    const base=h.state();
    base.bpInputMode='screen';
    base.language='eng';
    base.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];
    base.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];
    await h.send({type:'settings',settings:base});
    await page.addInitScript(()=>{
      localStorage.setItem('hok-player-slot-auto','1');
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');
        canvas.width=1920;canvas.height=1080;
        canvas.getContext('2d')!.fillRect(0,0,1920,1080);
        return canvas.captureStream(10);
      }});
    });
    let calls=0;
    await page.route('**/api/v1/recognition/players',async route=>{
      if(route.request().method()==='GET')return route.fulfill({json:{status:'ready'}});
      calls++;
      const order=[4,3,2,1,0];
      const confidence=calls===1?[.95,.95,.76,.95,.95]:[.95,.76,.95,.95,.95];
      const solution={order,confidence,average:confidence.reduce((a,b)=>a+b,0)/5,margin:.18,automatic:false,anomalies:[calls===1?2:1]};
      await route.fulfill({json:{
        texts:['Echo','Delta','Charlie','Bravo','Alpha','Juliet','India','Hotel','Golf','Fox'],
        confidences:Array(10).fill(.8),
        blue:solution,
        red:solution,
        elapsedMs:180,
      }});
    });
    await page.goto('/control');
    await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await expect.poll(()=>calls).toBeGreaterThanOrEqual(2);
    await expect.poll(()=>`${h.state().bluePlayerSlotOrder}|${h.state().redPlayerSlotOrder}`).toBe('4,3,2,1,0|4,3,2,1,0');
    await expect(page.locator('.player-slot-summary')).toContainText('Both synced');
  }finally{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:initialState()});
    h.close();
  }
});

test('real offline OCR captures and synchronizes both teams within two seconds',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const base=h.state();base.bpInputMode='screen';base.language='eng';base.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];base.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];await h.send({type:'settings',settings:base});
    const order=[4,3,2,1,0];
    const labels=(['blue','red'] as const).flatMap(side=>order.map((roster,index)=>{
      const pick=defaultCaptureSlots[`${side}Pick${index+1}` as CaptureSlotKey];
      const height=Math.max(.032,Math.min(.065,pick.height*.52));
      return {text:base[`${side}Team`].players[roster],x:side==='blue'?pick.x+pick.width+.004:pick.x-.164,y:pick.y+Math.max(0,(pick.height-height)/2),height};
    }));
    await page.addInitScript(({labels,slots})=>{
      localStorage.setItem('hok-player-slot-auto','1');localStorage.setItem('hok-window-capture-slots-v3',JSON.stringify(slots));
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d')!;
        ctx.fillStyle='#182030';ctx.fillRect(0,0,1920,1080);ctx.font='bold 28px DejaVu Sans';ctx.fillStyle='#e8eaf2';
        for(const label of labels)ctx.fillText(label.text,label.x*1920+12,(label.y+label.height/2)*1080+10);
        return canvas.captureStream(30);
      }});
    },{labels,slots:defaultCaptureSlots});
    await page.goto('/control');
    await expect.poll(async()=>{const r=await page.request.get('/api/v1/recognition/players',{headers:{Authorization:'Bearer e2e-control'}});return (await r.json()).status;}).toBe('ready');
    const start=Date.now();await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await expect.poll(()=>`${h.state().bluePlayerSlotOrder}|${h.state().redPlayerSlotOrder}`,{intervals:[20,30,50]}).toBe('4,3,2,1,0|4,3,2,1,0');
    const elapsed=Date.now()-start;console.log(`Real capture → OCR → both authoritative orders: ${elapsed} ms`);expect(elapsed).toBeLessThan(2000);
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('shared capture auto-aligns both teams once and manual correction remains authoritative',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const base=h.state();base.bpInputMode='screen';base.language='eng';base.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];base.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];await h.send({type:'settings',settings:base});
    await page.addInitScript(()=>{Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,1920,1080);return canvas.captureStream(10);}});});
    await page.route('**/api/v1/recognition/players',async route=>{if(route.request().method()==='GET')return route.fulfill({json:{status:'ready'}});const solution={order:[4,3,2,1,0],confidence:[.95,.95,.95,.95,.95],average:.95,margin:.2,automatic:true,anomalies:[]};await route.fulfill({json:{texts:['Echo','Delta','Charlie','Bravo','Alpha','Juliet','India','Hotel','Golf','Fox'],blue:solution,red:solution,elapsedMs:200}});});
    await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await expect.poll(()=>h.state().bluePlayerSlotOrder.join(',')).toBe('4,3,2,1,0');await expect.poll(()=>h.state().redPlayerSlotOrder.join(',')).toBe('4,3,2,1,0');
    await page.locator('.player-slot-team-card.blue').getByRole('button',{name:'Manual edit',exact:true}).click();
    await page.getByRole('combobox',{name:'blue P1 player',exact:true}).selectOption('0');await expect.poll(()=>h.state().bluePlayerSlotOrder.join(',')).toBe('0,3,2,1,4');
    await expect(page.locator('.player-slot-alignment input[type=checkbox]')).not.toBeChecked();
    await page.locator('.player-slot-team-card.red').getByRole('button',{name:'Manual edit',exact:true}).click();
    await page.getByRole('combobox',{name:'red P1 player',exact:true}).selectOption('0');
    await expect.poll(()=>h.state().redPlayerSlotOrder.join(',')).toBe('0,3,2,1,4');
    const beforeRestore=h.state().bluePlayerSlotOrder.join(',');
    expect(beforeRestore).toBe('0,3,2,1,4');
    await page.getByRole('button',{name:'Restore auto',exact:true}).click();
    await expect.poll(()=>h.state().bluePlayerSlotOrder.join(',')).toBe('4,3,2,1,0');
    await expect.poll(()=>h.state().redPlayerSlotOrder.join(',')).toBe('4,3,2,1,0');
    await expect(page.locator('.player-slot-alignment input[type=checkbox]')).toBeChecked();
    await expect(page.locator('.player-slot-summary')).toContainText('Both synced');
    await expect(page.getByRole('combobox',{name:'red P1 player',exact:true})).toHaveCount(0);
  }finally{await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});


test('Simulator can pull the current Control lineup, then time one isolated hero swap',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    await h.fill();

    // Start from a non-pick-order final ownership so the reverse-sync path is
    // proven to use assignments rather than immutable draft pick history.
    await h.send({type:'swap_assignments',team:'blue',from:0,to:2});
    const baselineBlue=[...h.state().blueAssignments] as number[];
    const baselineRed=[...h.state().redAssignments] as number[];

    await page.goto('/tools/bp-simulator-control#token=e2e-control');
    await page.getByRole('button',{name:/换英雄同步/}).click();
    await page.getByRole('button',{name:'从 Control 同步模拟器数据',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('已从 Control 读取当前最终阵容');

    const synced=await page.evaluate(()=>JSON.parse(localStorage.getItem('hok-bp-simulator-state-v3')||'null'));
    expect([1,2,3,4,5].map(index=>synced.slotHeroes[`bluePick${index}`])).toEqual(baselineBlue);
    expect([1,2,3,4,5].map(index=>synced.slotHeroes[`redPick${index}`])).toEqual(baselineRed);

    await page.getByRole('button',{name:'交换并开始计时',exact:true}).click();
    const targetBlue=[...baselineBlue];
    [targetBlue[0],targetBlue[1]]=[targetBlue[1],targetBlue[0]];
    await h.send({type:'set_lineup_assignments',blue:targetBlue,red:baselineRed});

    await expect(page.locator('.sim-test-result').filter({hasText:'Control 已识别新英雄归属'})).toBeVisible();
    await expect(page.getByRole('button',{name:'交换并开始计时',exact:true})).toBeEnabled();
  }finally{
    await h.send({type:'reset_match'});
    h.close();
  }
});
