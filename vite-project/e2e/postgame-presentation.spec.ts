import { openDockPanel } from './dockNavigation';
import {test,expect} from './fixtures';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {harness} from './harness';
import {initialState} from '../src/shared/types';
import type {PostGameMetric} from '../src/shared/postGame';

test('MVP resolves registered role, prioritizes photos, fills hero art, and separates role metrics from highlights',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';state.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];await h.send({type:'settings',settings:state});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports[0],selected=report.players[0],heroId=selected.heroId;
    const art=await readFile(new URL('../public/heroesArt/ao\'yin.jpg',import.meta.url));
    await page.route('**/test-mvp-art.jpg',route=>route.fulfill({contentType:'image/jpeg',body:art}));
    await page.route('**/test-mvp-photo.jpg',route=>route.fulfill({contentType:'image/jpeg',body:art}));
    await page.route('**/missing-mvp-photo.jpg',route=>route.fulfill({status:404,body:''}));
    await h.send({type:'hero_data_override',heroId,override:{artLink:'/test-mvp-art.jpg'}});await h.send({type:'hero_art_override',heroId,override:{panel:{x:45,y:25,scale:1.25}}});
    const changed=h.state();changed.blueTeam.playerRoles=['jungle','clash','mid','farm','roam'];changed.blueTeam.playerPortraits[0]='/test-mvp-photo.jpg';await h.send({type:'settings',settings:changed});
    expect(h.state().postGameReports[0].players[0].role).toBe('clash');
    const values={kills:8,deaths:2,assists:10,totalDamage:72000,participation:85,damageConversion:1.5,damageTaken:40000,damageShare:35,gold:12000,goldShare:30,healingShare:70,healing:15000,towerDamageShare:60,towerDamage:8000};
    await h.send({type:'post_game_fields',reportId:report.id,updates:Object.entries(values).map(([metric,value])=>({rowId:selected.rowId,metric:metric as PostGameMetric,field:{value,confidence:1,manual:true,sourcePage:'overview'}}))});await h.send({type:'select_mvp',reportId:report.id,rowId:selected.rowId});
    await page.setViewportSize({width:1920,height:1080});await page.goto('/overlay/mvp');
    await expect(page.locator('.mvp-screen-team')).toContainText('Jungle');await expect(page.locator('.mvp-screen-portrait img')).toHaveAttribute('src','/test-mvp-photo.jpg');
    const primary=await page.locator('.mvp-screen-metrics > div > span').allTextContents();expect(primary).toEqual(['Damage conversion','Participation','Total damage']);
    const extras=await page.locator('.mvp-screen-highlights > span').allTextContents();expect(extras.length).toBe(3);for(const label of primary)expect(extras.every(text=>!text.startsWith(label+' ·'))).toBe(true);
    const noPhoto=h.state();noPhoto.blueTeam.playerPortraits[0]='';await h.send({type:'settings',settings:noPhoto});
    await expect(page.locator('.mvp-screen-portrait img')).toHaveAttribute('src','/test-mvp-art.jpg');expect(await page.locator('.mvp-screen-portrait img').evaluate(img=>getComputedStyle(img).objectFit)).toBe('cover');expect(await page.locator('.mvp-screen-portrait img').evaluate(img=>getComputedStyle(img).objectPosition)).toBe('45% 25%');
    await h.send({type:'post_game_mvp_art_scale',reportId:report.id,scale:1.05});await expect.poll(()=>page.locator('.mvp-screen-portrait img').evaluate(img=>getComputedStyle(img).transform)).toContain('1.05');
    const badPhoto=h.state();badPhoto.blueTeam.playerPortraits[0]='/missing-mvp-photo.jpg';await h.send({type:'settings',settings:badPhoto});await expect(page.locator('.mvp-screen-portrait img')).toHaveAttribute('src','/test-mvp-art.jpg');
    await expect(page.locator('.mvp-screen-portrait img')).toHaveClass('mvp-hero-art');await page.screenshot({path:'artifacts/game-data/mvp-role-art-fixed.png',omitBackground:true});
    await h.send({type:'post_game_grades',reportId:report.id,updates:[{rowId:selected.rowId,field:{value:'B',manual:true,confidence:1,sourcePage:'summary'}}]});
    await page.goto('/overlay/postgame-compare?role=jungle');await expect(page.locator('.pg-player.blue strong')).toHaveText('Alpha');
    await expect(page.locator('.pg-player.blue')).toContainText('Game grade B');
    await expect(page.locator('.pg-number-compare')).toContainText('Gold share');
    await expect(page.locator('.pg-number-compare')).not.toContainText('Rating');
    await h.send({type:'post_game_fields',reportId:report.id,updates:[{rowId:selected.rowId,metric:'rating',field:{value:9.5,manual:true,confidence:1,sourcePage:'summary'}}]});
    await expect(page.locator('.pg-number-compare')).toContainText('Rating');
    const bounds=await page.locator('.pg-footer').boundingBox();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(1080);
    for(const role of ['clash','jungle','mid','farm','roam']){
      await page.goto('/overlay/postgame-'+role);
      await expect(page.locator('.pg-matchup-stage')).toHaveAttribute('data-matchup-role',role);
      await expect(page.locator('.pg-matchup-player')).toHaveCount(2);
      await expect(page.locator('.pg-role-tabs')).toHaveCount(0);
      await expect(page.locator('.pg-center-analysis .pg-number-compare')).toBeVisible();
      const footer=await page.locator('.pg-footer').boundingBox();
      expect(footer).not.toBeNull();
      expect(footer!.y+footer!.height).toBeLessThanOrEqual(1080);
    }
    await page.goto('/overlay/postgame-compare?role=jungle');
    await expect(page.locator('.pg-matchup-stage')).toHaveAttribute('data-matchup-role','jungle');
    await page.screenshot({path:'artifacts/full-audit/compare-grade-and-layout.png',omitBackground:true});
    await page.goto('/overlay/mvp');
    await expect(page.locator('.mvp-screen-hero').filter({hasText:'Game rating'})).toHaveText('Game rating · 9.5');
    await expect(page.locator('.mvp-screen-hero').filter({hasText:'Game grade'})).toHaveText('Game grade · B');
    const metrics=await page.locator('.mvp-screen-metrics').boundingBox();
    expect(metrics).not.toBeNull();expect(metrics!.y+metrics!.height).toBeLessThanOrEqual(1080);
    expect(metrics!.x).toBeGreaterThanOrEqual(0);expect(metrics!.x+metrics!.width).toBeLessThanOrEqual(1920);
  }finally{h.close();}
});

test('actual recap curve OCR saves with side reversal and renders a signed sideways T axis',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';await h.send({type:'settings',settings:state});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const fixtures=JSON.parse(await readFile(new URL('../server/fixtures/game-data-screenshots.json',import.meta.url),'utf8')) as {recap:string};
    const image=await sharp(Buffer.from(fixtures.recap,'base64')).composite([{input:await readFile(new URL('../server/fixtures/economy-curve-crossing.png',import.meta.url)),left:160,top:575}]).png().toBuffer();
    await expect.poll(async()=>{const response=await page.request.get('/api/v1/capabilities',{headers:{Authorization:'Bearer e2e-control'}});return (await response.json()).playerRecognition.status;},{timeout:30000}).toBe('ready');
    await page.goto('/control');await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();const capture=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    await capture.getByLabel('Game data screenshot').setInputFiles({name:'recap.png',mimeType:'image/png',buffer:image});await capture.getByLabel('Settlement page type',{exact:true}).selectOption('recap');await capture.getByRole('button',{name:'Capture full page',exact:true}).click();
    await expect(capture.getByText(/Read 16 chart markers/)).toBeVisible({timeout:30000});await expect(capture.locator('svg[data-axis="sideways-t"]')).toBeVisible();
    const apply=capture.getByRole('button',{name:'Apply reviewed team recap',exact:true});await expect(apply).toBeDisabled();await capture.getByLabel('Recap left side',{exact:true}).selectOption('red');await apply.click();
    await expect.poll(()=>h.state().postGameReports[0].goldDifference?.points.length).toBe(16);expect(Math.abs(h.state().postGameReports[0].goldDifference!.points.at(-1)!.difference+240)).toBeLessThanOrEqual(20);
    await page.goto('/overlay/game-progress');await page.setViewportSize({width:1920,height:1080});await expect(page.locator('.pg-progress-legend')).toContainText('Red advantage');await expect(page.locator('.pg-progress-legend')).not.toContainText('Blue gold');
    const zero=page.locator('.economy-zero-axis'),axis=page.locator('.economy-right-axis');expect(await zero.getAttribute('y1')).toBe(await zero.getAttribute('y2'));expect(await axis.getAttribute('x1')).toBe(await axis.getAttribute('x2'));expect(await zero.getAttribute('x2')).toBe(await axis.getAttribute('x1'));
    expect(await zero.getAttribute('y1')).not.toBe(await axis.getAttribute('y2'));await expect(page.locator('.pg-footer')).toBeVisible();await page.screenshot({path:'artifacts/game-data/economy-advantage-fixed.png',omitBackground:true});
  }finally{h.close();}
});

test('zoomed operator capture preserves readable curve points and shows its cursor warning before applying',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const state=initialState();state.language='eng';await h.send({type:'settings',settings:state});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const image=await readFile(new URL('../server/fixtures/economy-curve-zoomed.png',import.meta.url));
    await expect.poll(async()=>{const response=await page.request.get('/api/v1/capabilities',{headers:{Authorization:'Bearer e2e-control'}});return (await response.json()).playerRecognition.status;},{timeout:30000}).toBe('ready');
    await page.goto('/control');await openDockPanel(page,'postgame');await page.getByText('Post-game data and MVP',{exact:true}).click();const capture=page.getByText('Full-page settlement capture · game template',{exact:true}).locator('..');
    await capture.getByLabel('Game data screenshot').setInputFiles({name:'zoomed-recap.png',mimeType:'image/png',buffer:image});await capture.getByLabel('Settlement page type',{exact:true}).selectOption('recap');await capture.getByRole('button',{name:'Capture full page',exact:true}).click();
    await expect(capture.getByText(/Read 10 chart markers/)).toBeVisible({timeout:30000});await expect(capture.getByRole('note')).toContainText('Final marker obscured');
    await capture.getByLabel('Recap left side',{exact:true}).selectOption('blue');await capture.getByRole('button',{name:'Apply reviewed team recap',exact:true}).click();
    await expect.poll(()=>h.state().postGameReports[0].goldDifference?.points.length).toBe(10);expect(h.state().postGameReports[0].goldDifference?.partial).toBe(true);expect(h.state().postGameReports[0].goldDifference?.maxDifference).toBe(10700);expect(h.state().postGameReports[0].goldDifference?.points.at(-1)?.timeSeconds).toBe(590);
    await page.screenshot({path:'artifacts/game-data/zoomed-curve-review.png',fullPage:true});
    expect(h.state().postGameReports[0].goldDifference?.durationSeconds).toBe(660);
    await page.goto('/overlay/game-progress');await expect(page.getByText('Partial screenshot curve: final marker obscured; observed points only.',{exact:true})).toBeVisible();
    await expect(page.locator('.pg-progress-chart')).toContainText('11:00');
    expect(Number(await page.locator('.pg-progress-chart circle').last().getAttribute('cx'))).toBeLessThan(Number(await page.locator('.economy-right-axis').getAttribute('x1')));
  }finally{h.close();}
});
