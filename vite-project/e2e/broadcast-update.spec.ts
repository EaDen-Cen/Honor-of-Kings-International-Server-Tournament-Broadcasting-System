import { test, expect } from './fixtures';
import { harness } from './harness';
import heroes from '../src/components/HeroList';
import { openDockPanel } from './dockNavigation';
import sharp from 'sharp';

test('Ban recognition sends one crop and omits only its echoed preview when requested', async ({request,baseURL}) => {
  const h = await harness(baseURL);
  try {
    await h.send({type:'settings',settings:{...h.state(),bpInputMode:'screen'}});
    const headers = { Authorization: 'Bearer e2e-control' };
    const snapshot = await request.get('/api/match',{headers});
    expect(snapshot.ok()).toBeTruthy();
    const {revision} = await snapshot.json();
    const hero = heroes[0];
    const file = await request.get(hero.recognitionImageLink || hero.imageLink);
    expect(file.ok()).toBeTruthy();
    const png = await sharp(await file.body()).resize(72,72).png().toBuffer();
    const image = 'data:image/png;base64,' + png.toString('base64');
    const body = {image,revision,allowedHeroIds:[hero.id],shape:'circle'};
    const legacy = {...body,lockImage:image};
    const compact = {...body,omitEchoPreview:true};
    const read = async (data: typeof body) => {
      const response = await request.post('/api/recognize-frame',{headers,data});
      expect(response.ok()).toBeTruthy();
      return {payload:await response.json(),bytes:(await response.body()).length};
    };
    const before = await read(legacy), after = await read(compact);
    const {preview,...evidence} = before.payload;
    expect(preview).toBe(image);
    expect(evidence.candidates[0].heroId).toBe(hero.id);
    expect(after.payload).toEqual(evidence);
    const size = (value: typeof body) => Buffer.byteLength(JSON.stringify(value));
    expect(size(compact)).toBeLessThan(size(legacy) * 0.55);
    expect(after.bytes).toBeLessThan(before.bytes * 0.1);
    console.log(`72×72 Ban JSON bytes: request ${size(legacy)} → ${size(compact)}, response ${before.bytes} → ${after.bytes}`);
  } finally { h.close(); }
});

test('empty history, inline settings and BO win boxes follow authoritative side swaps',async({browser,baseURL})=>{
  const h=await harness(baseURL),context=await browser.newContext({viewport:{width:1920,height:1080}});
  try {
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...h.state(),language:'eng',scoreDisplay:'boxes',overlayLayout:'side'}});
    const page=await context.newPage();await page.goto('/overlay/draft#token=e2e-overlay');
    await expect(page.locator('.broadcast-side')).toBeVisible();
    await expect(page.locator('.draft-history')).toHaveCount(0);
    for (const [format,count] of [['BO1',1],['BO3',2],['BO5',3]] as const) {
      await h.send({type:'settings',settings:{...h.state(),seriesFormat:format}});
      await expect(page.locator('.blue-score .score-box')).toHaveCount(count);
      await expect(page.locator('.red-score .score-box')).toHaveCount(count);
    }
    await h.send({type:'score',team:'blue',delta:1});
    await expect(page.locator('.blue-score .lit')).toHaveCount(1);
    await h.send({type:'swap_sides'});await expect(page.locator('.red-score .lit')).toHaveCount(1);
    expect((await page.locator('.ban.hero-slot').first().boundingBox())!.width).toBeGreaterThanOrEqual(72);
    const control=await context.newPage();await control.goto('/control#token=e2e-control');
    await control.getByRole('button',{name:'Match settings',exact:true}).click();
    await expect(control.locator('.settings-inline')).toBeVisible();
    await expect(control.locator('dialog[open]')).toHaveCount(0);
    await openDockPanel(control, 'settings');
    await expect(control.getByRole('button',{name:'Apply AI settings',exact:true})).toBeVisible();
    await h.fill();
    await expect(page.locator('.hero-art')).toHaveCount(10);
    await expect(page.locator('.hero-reveal:not([class="hero-reveal"])')).toHaveCount(0);
    await page.screenshot({path:'artifacts/side-full-art.png',omitBackground:true});
  } finally {h.close();await context.close();}
});

test('recognition requires review; rejection and stale results cannot submit; manual fallback works',async({browser,baseURL})=>{
  const h=await harness(baseURL),context=await browser.newContext();
  try {
    await h.send({type:'reset_match'});await h.send({type:'settings',settings:{...h.state(),language:'eng',bpInputMode:'screen',recognitionAutoAccept:false}});
    const page=await context.newPage();let fail=false, requestedImage='';
    await page.addInitScript(()=>{
      localStorage.setItem('hok-capture-auto-watch','0');localStorage.setItem('hok-player-slot-auto','0');localStorage.setItem('hok-lineup-auto','0');
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
        canvas.getContext('2d')!.fillRect(0,0,1920,1080);return canvas.captureStream(10);
      }});
    });
    await page.route('**/api/recognize-frame',async route=>{
      const body=route.request().postDataJSON();
      requestedImage=body.image;
      expect(body.image).toMatch(/^data:image\/png;base64,/);expect(body.shape).toBe('circle');
      expect(body.lockImage).toBeUndefined();expect(body.omitEchoPreview).toBe(true);
      await route.fulfill({status:fail?503:200,json:fail?{error:'disabled'}:{candidates:[{heroId:heroes[0].id,confidence:.96}],lockCue:'padlock'}});
    });
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button',{name:'Choose game window',exact:true}).click();
    const scan=page.getByRole('button',{name:'Recognize now',exact:true});
    const review=page.getByRole('dialog',{name:'Review recognition',exact:true});
    for(let i=0;i<3;i++){
      await scan.click();await expect(scan).toBeEnabled();
      if(i<2)await expect(review).not.toBeVisible();
    }
    await expect(review).toBeVisible();expect(h.state().currentPhase).toBe(0);
    await expect(review.getByRole('img',{name:'Current slot capture'})).toHaveAttribute('src',requestedImage);
    await review.getByRole('button',{name:'Reject / keep watching',exact:true}).click();
    await expect(review).toHaveCount(0);expect(h.state().currentPhase).toBe(0);expect(h.state().blueBans).toEqual([]);

    await scan.click();await expect(review).toBeVisible();
    await h.send({type:'skip_ban',team:'blue'});await expect(review).toHaveCount(0);
    expect(h.state().currentPhase).toBe(1);
    await h.send({type:'undo'});
    await expect(page.locator('.screen-input .capture-explicit-slot.blue.active')).toHaveCount(1);
    expect(h.state().currentPhase).toBe(0);expect(h.state().blueBans).toEqual([]);

    const capturedAt=Date.now();await page.clock.setFixedTime(capturedAt);
    for(let i=0;i<3;i++){await scan.click();await expect(scan).toBeEnabled();}
    await expect(review).toBeVisible();
    await page.clock.setFixedTime(capturedAt+31000);
    await review.getByRole('button',{name:'Confirm and submit',exact:true}).click();
    await expect(review).toHaveCount(0);
    await expect(page.locator('.screen-input [role="status"]')).toContainText('Result expired. Capture again.');
    expect(h.state().currentPhase).toBe(0);expect(h.state().blueBans).toEqual([]);

    await scan.click();await expect(review).toBeVisible();
    await review.getByRole('button',{name:'Confirm and submit',exact:true}).click();
    await expect.poll(()=>h.state().currentPhase).toBe(1);expect(h.state().blueBans).toEqual([heroes[0].id]);
    fail=true;await scan.click();
    await expect(page.locator('.screen-input [role="status"]')).toContainText('Window-frame recognition failed.');
    expect(h.state().currentPhase).toBe(1);
    await page.getByText('Manual hero picker (fallback)',{exact:true}).click();
    await page.getByLabel('Search heroes',{exact:true}).fill(heroes[1].englishName);
    await page.locator('.manual-picker-fallback .hero-grid').getByRole('button',{name:heroes[1].englishName,exact:true}).click();
    await expect.poll(()=>h.state().currentPhase).toBe(2);expect(h.state().redBans).toEqual([heroes[1].id]);
  } finally {h.close();await context.close();}
});
