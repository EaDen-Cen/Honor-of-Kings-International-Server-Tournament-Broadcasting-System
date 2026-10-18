import { test, expect, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { harness } from './harness';
import heroes from '../src/components/HeroList';
import { phases } from '../src/shared/types';
import { draftRestriction } from '../src/shared/draftRules';

async function inView(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}
for (const firstPickSide of ['blue','red'] as const) {
  test(`V2.3 ${firstPickSide} first: same-screen monitor and keyboard-only 18-phase recording`, async ({browser,baseURL}) => {
    const h = await harness(baseURL), context = await browser.newContext({viewport:{width:1440,height:900}});
    try {
      await h.send({type:'reset_match'});
      await h.send({type:'settings',settings:{...h.state(),language:'eng',firstPickSide}});
      const page = await context.newPage(); await page.goto('/control#token=e2e-control');
      const errors:string[]=[];page.on('pageerror', e=>errors.push(e.message));
      await expect(page.locator('.status')).toHaveText('Connected');
      for (const viewport of [{width:1920,height:1080},{width:1440,height:900}]) {
        await page.setViewportSize(viewport);
        await inView(page,'.compact-board'); await inView(page,'input[aria-label="Search heroes"]'); await inView(page,'.hero-grid button');
        const initial = await page.locator('.compact-board').boundingBox();
        await page.locator('.hero-grid-scroll').evaluate(e=>{e.scrollTop=e.scrollHeight;});
        expect((await page.locator('.compact-board').boundingBox())!.y).toBe(initial!.y);
        expect(await page.evaluate(()=>scrollY)).toBe(0);
        await page.locator('.hero-grid-scroll').evaluate(e=>{e.scrollTop=0;});
      }
      await page.keyboard.press('Control+k');
      const search = page.getByLabel('Search heroes',{exact:true}); await expect(search).toBeFocused();
      await search.fill(''); await search.press('Enter'); expect(h.state().currentPhase).toBe(0);
      await search.fill('not-a-hero');await search.press('Escape');await expect(search).toHaveValue('');
      await page.getByRole('button',{name:'Team settings',exact:true}).click();
      await expect(page.locator('.team-settings-dialog')).toBeVisible();
      await page.getByLabel('Team name',{exact:true}).first().fill('Operator Team');
      await page.keyboard.press('/'); await expect(page.getByLabel('Team name',{exact:true}).first()).toHaveValue('Operator Team/');
      page.once('dialog',dialog=>dialog.accept());
      await page.keyboard.press('Escape');await expect(page.locator('.team-settings-dialog')).toHaveCount(0);
      await page.keyboard.press('/');await expect(search).toBeFocused();
      for (let i=0;i<18;i++) {
        const state=h.state(), phase=phases(state.draftMode,state.firstPickSide)[i];
        const used=[...state.blueBans,...state.redBans,...state.bluePicks,...state.redPicks];
        const hero=heroes.find(hero=>!used.includes(hero.id)&&!draftRestriction(state,phase.team,phase.action,hero.id))!;
        await search.fill(hero.chineseName);
        await expect(page.locator('.hero-grid button:not(:disabled)')).toHaveCount(1);
        await search.press('Enter');
        await expect(search).toHaveValue('');await expect(search).toBeFocused();
        await expect.poll(()=>h.state().currentPhase).toBe(i+1);
        expect([...h.state().blueBans,...h.state().redBans,...h.state().bluePicks,...h.state().redPicks]).toHaveLength(i+1);
      }
      expect(h.state().draftComplete).toBe(true);await expect(page.locator('.error')).toHaveCount(0);
      await page.bringToFront();await page.screenshot({path:`artifacts/v23-cockpit-${firstPickSide}.png`});
      if(firstPickSide === 'blue') {
        for(const viewport of [{width:900,height:900},{width:390,height:844}]) {
          await page.setViewportSize(viewport);
          await page.locator('.hero-grid button').nth(60).scrollIntoViewIfNeeded();
          await inView(page,'.current-phase');
          if(viewport.width===900) await inView(page,'.compact-board');
          expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(viewport.width);
          await page.bringToFront();await page.screenshot({path:`artifacts/v23-cockpit-${viewport.width}.png`});
        }
      }
      expect(errors).toEqual([]);
    } finally {h.close();await context.close();}
  });
}

test('V2.3 search clears only on matching ACK and ignores repeated/IME Enter',async ({browser,baseURL})=>{
  const h=await harness(baseURL),context=await browser.newContext();
  let release:(()=>void)|undefined;
  await context.routeWebSocket('**/ws',route=>{
    const server=route.connectToServer();
    server.onMessage(message=>{
      const packet=JSON.parse(String(message));
      if(packet.type==='ack') release=()=>route.send(message); else route.send(message);
    });
  });
  try {
    await h.send({type:'reset_match'});await h.send({type:'settings',settings:{...h.state(),language:'eng'}});
    const page=await context.newPage();await page.goto('/control#token=e2e-control');await expect(page.locator('.status')).toHaveText('Connected');
    const search=page.getByLabel('Search heroes',{exact:true});await search.fill(heroes[0].chineseName);
    await search.dispatchEvent('keydown',{key:'Enter',isComposing:true});expect(h.state().currentPhase).toBe(0);
    await search.press('Enter');await expect.poll(()=>h.state().currentPhase).toBe(1);
    await expect(search).toHaveValue(heroes[0].chineseName);
    await search.press('Enter');expect(h.state().currentPhase).toBe(1);
    await expect.poll(()=>!!release).toBe(true);release!();await expect(search).toHaveValue('');await expect(search).toBeFocused();
  } finally {h.close();await context.close();}
});

test('V2.3 real portrait upload, PNG/JPEG/WebP, runtime serving, preview errors, reveal and undo',async ({browser,baseURL,request})=>{
  const h=await harness(baseURL),context=await browser.newContext({viewport:{width:1440,height:900}});
  try {
    await h.send({type:'reset_match'});await h.send({type:'settings',settings:{...h.state(),language:'eng'}});
    await h.send({type:'delay',seconds:3600});
    const page=await context.newPage(),overlay=await context.newPage(),caster=await context.newPage();
    await page.goto('/control#token=e2e-control');await overlay.setViewportSize({width:1920,height:1080});
    await overlay.goto('/overlay/draft#token=e2e-overlay');await caster.goto('/caster#token=e2e-caster');
    await page.getByRole('button',{name:'Team settings',exact:true}).click();
    const input=page.getByLabel('Player portrait URL',{exact:true}).first();
    await input.fill('https://');await expect(page.locator('.team-settings-dialog')).toBeVisible();
    await input.fill('/playerImg/missing.png');await expect(page.locator('.portrait-status').first()).toHaveText('Portrait failed to load. Check the URL or upload again.');
    await page.getByLabel('Choose image',{exact:true}).first().setInputFiles('e2e/fixtures/player-test.png');
    await expect(input).toHaveValue(/^\/uploads\/player-portraits\/[0-9a-f-]+\.png$/);
    await expect(page.locator('.portrait-status').first()).toHaveText('Portrait loaded');
    const url=await input.inputValue();
    await expect(overlay.locator('.player-portrait')).toHaveCount(0);
    await page.getByRole('button',{name:'Save settings',exact:true}).click();
    await expect(overlay.locator('.pick-team.blue .player-portrait').first()).toHaveAttribute('src',url);
    expect((await request.get(url)).status()).toBe(200);
    expect(await caster.evaluate(async url=>(await fetch(url)).status,url)).toBe(200);
    const delayed=await request.get('/api/match',{headers:{Authorization:'Bearer e2e-caster'}});
    expect((await delayed.json()).state.blueTeam.playerPortraits[0]).toBe(url);
    // Convert the genuine test portrait, rather than substituting hero artwork.
    const png=readFileSync('e2e/fixtures/player-test.png').toString('base64');
    for(const [mime,extension] of [['image/jpeg','jpg'],['image/webp','webp']]) {
      const data=await page.evaluate(async({png,mime})=>{
        const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d')!.drawImage(image,0,0);return canvas.toDataURL(mime).split(',')[1];
      },{png,mime});
      const response=await request.post('/api/uploads/player-portrait',{headers:{Authorization:'Bearer e2e-control','Content-Type':mime,'X-File-Name':'portrait.'+extension},data:Buffer.from(data,'base64')});
      expect(response.status()).toBe(201);expect((await request.get((await response.json()).url)).status()).toBe(200);
    }
    await page.getByRole('button',{name:'Close team settings',exact:true}).click();
    for(let i=0;i<5;i++) await h.send({type:'draft_action',...phases('match')[i],heroId:heroes[i].id});
    await expect(overlay.locator('.pick-team.blue .hero-art')).toHaveCount(1);
    await expect(overlay.locator('.pick-team.blue .player-portrait')).toHaveCount(0);
    await h.send({type:'undo'});await expect(overlay.locator('.pick-team.blue .player-portrait').first()).toHaveAttribute('src',url);
    await page.reload();await page.getByRole('button',{name:'Team settings',exact:true}).click();
    await expect(page.getByLabel('Player portrait URL',{exact:true}).first()).toHaveValue(url);
    await page.getByRole('button',{name:'Clear image',exact:true}).first().click();
    await page.getByRole('button',{name:'Save settings',exact:true}).click();await expect(overlay.locator('.player-portrait')).toHaveCount(0);
    expect((await request.get(url)).status()).toBe(200); // Historical snapshots must retain access.
  } finally {h.close();await context.close();}
});
