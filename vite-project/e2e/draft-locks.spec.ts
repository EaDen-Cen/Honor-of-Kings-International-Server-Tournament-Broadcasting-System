import {test,expect} from './fixtures';
import {detectDraftLockCue} from '../server/draftCueDetection';
import {createDefaultBpSimulatorState} from '../src/simulator/bpSimulatorState';
import {harness} from './harness';
import {phases,initialState} from '../src/shared/types';

test('Pick uses each own checkmark without waiting for next preselection; double Pick waits for both',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try {
    await h.send({type:'reset_match'});
    const settings=h.state();settings.language='eng';settings.bpInputMode='screen';settings.recognitionAutoAccept=false;
    await h.send({type:'settings',settings});
    while(phases(h.state().draftMode,h.state().firstPickSide)[h.state().currentPhase].action==='ban') {
      await h.send({type:'skip_ban',team:phases(h.state().draftMode,h.state().firstPickSide)[h.state().currentPhase].team});
    }
    await page.addInitScript(()=>{
      localStorage.setItem('hok-capture-auto-watch','0');localStorage.setItem('hok-player-slot-auto','0');
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.getContext('2d')!.fillRect(0,0,1920,1080);return canvas.captureStream(10);
      }});
    });
    let group=false,both=false,first=false,calls=0;
    await page.route('**/api/recognize-frame',async route=>{
      const body=route.request().postDataJSON();expect(body.lockImage).toMatch(/^data:image\/png;base64,/);
      const slot=group?calls++%2:0;
      await route.fulfill({json:{preview:body.image,candidates:[{heroId:group?20+slot:10,confidence:.95},{heroId:30,confidence:.2}],fingerprint:slot?'ffffffffffffffff':'0000000000000000',meanLuma:slot?10:220,lockCue:(group?(slot===0||both):first)?'checkmark':'none'}});
    });
    await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    const scan=page.getByRole('button',{name:'Recognize now',exact:true});
    const review=page.locator('dialog.capture-review');
    for(let i=0;i<4;i++) {await scan.click();await expect(scan).toBeEnabled();}
    await expect(review).not.toBeVisible();
    first=true;
    for(let i=0;i<2;i++) {await scan.click();await expect(scan).toBeEnabled();}
    await expect(review).toBeVisible();
    await review.getByRole('button',{name:'Confirm and submit',exact:true}).click();
    await expect.poll(()=>h.state().bluePicks.length).toBe(1);
    group=true;calls=0;
    for(let i=0;i<4;i++) {await scan.click();await expect(scan).toBeEnabled();}
    await expect(review).not.toBeVisible();
    both=true;
    for(let i=0;i<2;i++) {await scan.click();await expect(scan).toBeEnabled();}
    await expect(review).toBeVisible();await expect(review.locator('.pick-group-review-entry')).toHaveCount(2);
    await review.getByRole('button',{name:'Confirm and submit',exact:true}).click();
    await expect.poll(()=>h.state().redPicks.length).toBe(2);
  } finally {await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});

test('low-confidence Ban with a lock never becomes empty Ban, and all heroes remain manually selectable',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try {
    await h.send({type:'reset_match'});
    const settings=h.state();settings.language='eng';settings.bpInputMode='screen';await h.send({type:'settings',settings});
    await page.addInitScript(()=>{
      localStorage.setItem('hok-capture-auto-watch','0');localStorage.setItem('hok-player-slot-auto','0');
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.getContext('2d')!.fillRect(0,0,1920,1080);return canvas.captureStream(10);
      }});
    });
    let trusted=false;
    await page.route('**/api/recognize-frame',async route=>{
      const body=route.request().postDataJSON();await route.fulfill({json:{preview:body.image,lockCue:'padlock',fingerprint:'ffffffffffffffff',lockFingerprint:'ffffffffffffffff',candidates:[{heroId:4,confidence:trusted?.95:.48},{heroId:15,confidence:.32}]}});
    });
    await page.goto('/control');await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    const scan=page.getByRole('button',{name:'Recognize now',exact:true});
    for(let i=0;i<7;i++) {await scan.click();await expect(scan).toBeEnabled();}
    await expect(page.locator('dialog.capture-review')).not.toBeVisible();expect(h.state().currentPhase).toBe(0);
    await page.getByRole('button',{name:'Review current top candidate',exact:true}).click();
    const review=page.locator('dialog.capture-review');await expect(review).toBeVisible();
    await review.locator('select').selectOption('109');
    await review.getByRole('button',{name:'Confirm and submit',exact:true}).click();
    await expect.poll(()=>h.state().blueBans[0]).toBe(109);
    trusted=true;
    for(let i=0;i<3;i++) {await scan.click();await expect(scan).toBeEnabled();}
    await expect(review).toBeVisible();
    await review.getByRole('button',{name:'Confirm and submit',exact:true}).click();
    await expect.poll(()=>h.state().redBans[0]).toBe(4);
  } finally {await h.send({type:'reset_match'});await h.send({type:'settings',settings:initialState()});h.close();}
});



test('Simulator renders detectable Pick and Ban marks at each supported size boundary',async({page})=>{
  await page.goto('/tools/bp-simulator');
  for(const [banSize,pickSize] of [[24,48],[38,72],[64,104]]) {
    const state={...createDefaultBpSimulatorState(),phaseIndex:7,banSize,pickSize,locked:['bluePick1','redPick1','redPick2']};
    await page.evaluate(value=>localStorage.setItem('hok-bp-simulator-state-v3',JSON.stringify(value)),state);
    await page.reload();
    await page.locator('[data-slot="bluePick1"] img').waitFor();
    for(const [slot,kind,avatar] of [['blueBan1','padlock','sim-ban-avatar'],['redBan1','padlock','sim-ban-avatar'],['bluePick1','checkmark','sim-pick-avatar'],['redPick1','checkmark','sim-pick-avatar']] as const) {
      const box=(await page.locator(`[data-slot="${slot}"] .${avatar}`).boundingBox())!;
      const buffer=await page.screenshot({clip:{x:box.x,y:box.y,width:box.width,height:box.height*(kind==='checkmark'?1.3:1)}});
      expect(await detectDraftLockCue(buffer,kind==='padlock'),`${slot} ${banSize}/${pickSize}`).toBe(kind);
    }
  }
});
