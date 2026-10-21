import { openDockPanel } from './dockNavigation';
import { test, expect, type Page } from './fixtures';
import { harness } from './harness';
import { initialState, phases } from '../src/shared/types';

async function mockWindow(page:Page,lineupAuto=false){
  await page.addInitScript(({lineupAuto})=>{
    localStorage.setItem('hok-capture-auto-watch','0');
    localStorage.setItem('hok-player-slot-auto','0');
    localStorage.setItem('hok-lineup-auto',lineupAuto?'1':'0');
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
      const ctx=canvas.getContext('2d')!;
      ctx.fillStyle='#18243a';ctx.fillRect(0,0,1920,1080);
      ctx.fillStyle='#dde8f4';ctx.fillRect(300,100,900,700);
      return canvas.captureStream(10);
    }});
  },{lineupAuto});
}

test('a late BP response cannot repopulate the candidate from a previous phase',async({page,baseURL})=>{
  const h=await harness(baseURL);let release=()=>{};
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await mockWindow(page);
    let sent=false,finished=false;
    await page.route('**/api/recognize-frame',async route=>{
      sent=true;
      await new Promise<void>(resolve=>{release=resolve;});
      await route.fulfill({json:{candidates:[{heroId:1,confidence:.99}],preview:'data:image/png;base64,iVBORw0KGgo=',lockCue:'padlock'}});
      finished=true;
    });
    await page.goto('/control');
    await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    const bp=page.locator('.screen-input');
    await bp.getByRole('button',{name:'Recognize now',exact:true}).click();
    await expect.poll(()=>sent).toBe(true);
    const state=h.state(),phase=phases(state.draftMode,state.firstPickSide,state.banCount)[state.currentPhase];
    await h.send({type:'skip_ban',team:phase.team});
    await expect(bp.locator('.capture-live-status')).toContainText(h.state().redTeam.name);
    release();await expect.poll(()=>finished).toBe(true);
    await expect(bp.getByRole('button',{name:'Recognize now',exact:true})).toBeEnabled();
    await expect(bp.getByRole('button',{name:'Review current top candidate',exact:true})).toBeDisabled();
    await expect(bp.locator('dialog')).toHaveCount(0);
  }finally{release();h.close();}
});

test('pausing automatic hero swaps invalidates an already running ten-slot scan',async({page,baseURL})=>{
  const h=await harness(baseURL);let release=()=>{};
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await h.fill();
    const beforeBlue=[...h.state().blueAssignments],beforeRed=[...h.state().redAssignments];
    await mockWindow(page,true);
    let calls=0,finished=false;
    const slotCounts=new Map<string,number>();
    await page.route('**/api/recognize-frame',async route=>{
      const ids=route.request().postDataJSON().allowedHeroIds as number[],key=ids.join(',');
      const slot=slotCounts.get(key)??0;slotCounts.set(key,slot+1);
      const first=++calls===1;
      if(first)await new Promise<void>(resolve=>{release=resolve;});
      await route.fulfill({json:{candidates:[{heroId:ids[(slot+1)%5],confidence:.99}],preview:'data:image/png;base64,iVBORw0KGgo='}});
      if(first)finished=true;
    });
    await page.goto('/control');
    await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await expect.poll(()=>calls).toBeGreaterThanOrEqual(2);
    const lineup=page.locator('.lineup-sync');
    await lineup.getByRole('checkbox',{name:'Automatically detect and sync hero swaps',exact:true}).uncheck();
    release();await expect.poll(()=>finished).toBe(true);
    await expect(lineup.getByRole('button',{name:'Recognize and apply swap now',exact:true})).toBeEnabled();
    expect(h.state().blueAssignments).toEqual(beforeBlue);
    expect(h.state().redAssignments).toEqual(beforeRed);
    await expect(lineup.getByRole('button',{name:'Apply this scan',exact:true})).toHaveCount(0);
  }finally{release();h.close();}
});

test('duplicate settlement bindings cannot receive manual data, and a grade warning preserves numerical review',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports.find(r=>r.id===h.state().activePostGameReportId)!;
    await mockWindow(page);
    await page.route('**/api/v1/recognition/settlement',async route=>route.fulfill({json:{
      page:'summary',reportId:report.id,capturedAt:Date.now(),elapsedMs:50,
      evidence:'/uploads/player-portraits/00000000-0000-0000-0000-000000000000.png',
      rows:report.players.map((p,screenRow)=>({screenRow,text:p.playerId,rowId:p.rowId,suggestedRowId:p.rowId})),
      candidates:report.players.map((_,screenRow)=>({screenRow,metric:'gold',value:7500+screenRow,confidence:.99,text:String(7500+screenRow)})),
      gradeWarning:'Letter-grade worker busy',
    }}));
    await page.goto('/control');
    await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();
    const settlement=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    await settlement.getByRole('button',{name:'Capture full page',exact:true}).click();
    await expect(settlement.getByText(/Letter grades could not be read/)).toBeVisible();
    await expect(settlement.getByRole('button',{name:'Apply reviewed high-confidence fields',exact:true})).toBeEnabled();
    await settlement.getByLabel('Settlement identity 1',{exact:true}).selectOption(report.players[0].rowId);
    await expect(settlement.getByLabel('Settlement 0 gold',{exact:true})).toBeDisabled();
    await expect(settlement.getByLabel('Settlement 1 gold',{exact:true})).toBeDisabled();
    await expect(settlement.getByRole('button',{name:'Apply reviewed high-confidence fields',exact:true})).toBeDisabled();
    await settlement.getByLabel('Settlement identity 1',{exact:true}).selectOption(report.players[1].rowId);
    const gold=settlement.getByLabel('Settlement 0 gold',{exact:true});
    await gold.fill('-1');await gold.press('Tab');
    expect(h.state().postGameReports.find(r=>r.id===report.id)!.players[0].fields.gold).toBeUndefined();
    await gold.fill('7589');await gold.press('Tab');
    await expect.poll(()=>h.state().postGameReports.find(r=>r.id===report.id)!.players[0].fields.gold?.value).toBe(7589);
  }finally{h.close();}
});

test('red-left settlement pages bind the correct roster, retain numerical drafts and isolate direction by report',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports.find(r=>r.id===h.state().activePostGameReportId)!;
    await mockWindow(page);
    const directions:string[]=[];
    await page.route('**/api/v1/recognition/settlement',async route=>{
      const input=route.request().postDataJSON(),left=input.leftSide==='red'?'red':'blue';
      directions.push(left);
      const players=[...report.players.filter(p=>p.side===left),...report.players.filter(p=>p.side!==left)];
      await route.fulfill({json:{
        page:'summary',leftSide:left,reportId:report.id,capturedAt:Date.now(),elapsedMs:50,
        evidence:'/uploads/player-portraits/00000000-0000-0000-0000-000000000000.png',
        rows:players.map((p,screenRow)=>({screenRow,text:p.playerId,rowId:p.rowId,suggestedRowId:p.rowId})),
        candidates:players.map((_,screenRow)=>({screenRow,metric:'gold',value:7000+screenRow,confidence:.99,text:String(7000+screenRow)})),
      }});
    });
    await page.goto('/control');
    await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();
    const settlement=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    await settlement.getByRole('button',{name:'Capture full page',exact:true}).click();
    await expect(settlement.getByLabel('Settlement identity 0',{exact:true})).toHaveValue(report.players.find(p=>p.side==='blue')!.rowId);
    await settlement.getByLabel('Settlement left team',{exact:true}).selectOption('red');
    await expect(settlement.getByLabel('Settlement identity 0',{exact:true})).toHaveValue('');
    await expect(settlement.locator('.settlement-review tbody tr').first()).toContainText('7,000');
    await expect(settlement.getByRole('button',{name:'Apply reviewed high-confidence fields',exact:true})).toBeDisabled();
    await settlement.getByRole('button',{name:'Capture full page',exact:true}).click();
    await expect(settlement.getByLabel('Settlement identity 0',{exact:true})).toHaveValue(report.players.find(p=>p.side==='red')!.rowId);
    await expect(settlement.getByLabel('Settlement identity 5',{exact:true})).toHaveValue(report.players.find(p=>p.side==='blue')!.rowId);
    await expect(settlement.getByLabel('Settlement identity 0',{exact:true}).locator('option[value]:not([value=""])')).toHaveCount(5);
    expect(await settlement.getByLabel('Settlement identity 0',{exact:true}).locator('option[value]:not([value=""])').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(report.players.filter(p=>p.side==='red').map(p=>p.rowId));
    await settlement.getByRole('button',{name:'Apply reviewed high-confidence fields',exact:true}).click();
    await expect.poll(()=>h.state().postGameReports.find(r=>r.id===report.id)!.players.find(p=>p.side==='red')!.fields.gold?.value).toBe(7000);
    expect(h.state().postGameReports.find(r=>r.id===report.id)!.players.find(p=>p.side==='blue')!.fields.gold?.value).toBe(7005);
    expect(directions).toEqual(['blue','red']);

    await page.reload();await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();
    await expect(settlement.getByLabel('Settlement left team',{exact:true})).toHaveValue('red');
    await h.send({type:'reset_match'});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    await expect(settlement.getByLabel('Settlement left team',{exact:true})).toHaveValue('blue');
  }finally{h.close();}
});

test('manual BP review can interrupt an in-flight recognition pass',async({page,baseURL})=>{
  const h=await harness(baseURL);
  let release=()=>{};
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await mockWindow(page);
    let calls=0,secondStarted=false;
    await page.route('**/api/recognize-frame',async route=>{
      calls++;
      if(calls===2){
        secondStarted=true;
        await new Promise<void>(resolve=>{release=resolve;});
      }
      try{await route.fulfill({json:{candidates:[{heroId:1,confidence:.99}],preview:'data:image/png;base64,iVBORw0KGgo=',lockCue:'unknown'}});}catch{/* operator aborted this request */}
    });
    await page.goto('/control');
    await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    const bp=page.locator('.screen-input');
    await bp.getByRole('button',{name:'Recognize now',exact:true}).click();
    await expect(bp.getByRole('button',{name:'Review current top candidate',exact:true})).toBeEnabled();
    await bp.getByRole('button',{name:'Recognize now',exact:true}).click();
    await expect.poll(()=>secondStarted).toBe(true);
    await expect(bp.getByRole('button',{name:'Review current top candidate',exact:true})).toBeEnabled();
    await bp.getByRole('button',{name:'Review current top candidate',exact:true}).click();
    await expect(bp.locator('dialog')).toBeVisible();
    release();
    await expect(bp.locator('dialog')).toBeVisible();
    await expect(bp.getByRole('button',{name:'Recognize now',exact:true})).toBeEnabled();
  }finally{release();h.close();}
});

test('manual blue-side hero reassignment reaches authoritative server state and confirmed UI status',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...initialState(),language:'eng',bpInputMode:'screen'}});
    await h.fill();
    const beforeBlue=[...h.state().blueAssignments],beforeRed=[...h.state().redAssignments];
    const swapped=[beforeBlue[1],beforeBlue[0],...beforeBlue.slice(2)];
    await mockWindow(page,false);
    await page.goto('/control');
    const select=page.locator('.lineup-team.blue .lineup-player-row select').first();
    await expect(select).toBeVisible();
    await select.selectOption(String(beforeBlue[1]));
    await expect.poll(()=>h.state().blueAssignments,{timeout:15000}).toEqual(swapped);
    expect(h.state().redAssignments).toEqual(beforeRed);
    await expect(page.getByTestId('lineup-apply-state')).toHaveAttribute('data-status','applied',{timeout:10000});
  }finally{h.close();}
});
