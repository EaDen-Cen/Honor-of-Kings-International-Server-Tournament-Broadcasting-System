import { test,expect,type Route } from './fixtures';
import { harness } from './harness';
import { initialState } from '../src/shared/types';
import { timelineToText } from '../src/shared/postGameTimeline';

test('manual HUD drafts save whole numbers, retain edits across live updates and can clear unknown data',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});await h.send({type:'settings',settings:{...initialState(),language:'eng'}});
    await page.goto('/control');await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();
    const gold=page.getByLabel('blueGold',{exact:true});
    await gold.pressSequentially('1500');expect(h.state().liveGameStats.blueGold).toBeUndefined();
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,redKills:7,blueGold:1200}});
    await expect(gold).toHaveValue('1500');await gold.press('Enter');
    await expect.poll(()=>h.state().liveGameStats.blueGold).toBe(1500);expect(h.state().liveGameStats.redKills).toBe(7);
    await expect(gold).toBeEnabled();await gold.fill('');await gold.press('Enter');
    await expect.poll(()=>h.state().liveGameStats.blueGold).toBeUndefined();expect(h.state().liveGameStats.sources?.blueGold?.source).toBe('manual');
    const kills=page.getByLabel('blueKills',{exact:true});await kills.fill('1000');await kills.press('Tab');
    await expect(kills).toHaveAttribute('aria-invalid','true');expect(h.state().liveGameStats.blueKills).toBe(0);
    await kills.focus();await kills.press('Escape');await expect(kills).toHaveValue('0');
    await kills.fill('123');await kills.press('Enter');await expect.poll(()=>h.state().liveGameStats.blueKills).toBe(123);
  }finally{h.close();}
});

test('post-game rating drafts survive external edits and replay timelines stay in sync without losing drafts',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});const initial=initialState();initial.language='eng';initial.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];initial.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];
    await h.send({type:'settings',settings:initial});await h.fill();await h.send({type:'commit_game'});await h.send({type:'post_game_begin'});
    const report=h.state().postGameReports[0],rowId=report.players[0].rowId;
    await page.goto('/control');await page.getByText('Post-game data and MVP',{exact:true}).click();await page.getByText('Player ratings · manual fallback',{exact:true}).click();
    const rating=page.getByLabel(`Rating ${rowId}`,{exact:true});await rating.fill('12.5');
    await h.send({type:'post_game_fields',reportId:report.id,updates:[{rowId,metric:'rating',field:{value:7,confidence:1,manual:true,sourcePage:'overview'}}]});
    await expect(rating).toHaveValue('12.5');await rating.press('Enter');await expect.poll(()=>h.state().postGameReports[0].players[0].fields.rating?.value).toBe(12.5);
    await expect(rating).toBeEnabled();await rating.fill('101');await rating.press('Tab');await expect(rating).toHaveAttribute('aria-invalid','true');expect(h.state().postGameReports[0].players[0].fields.rating?.value).toBe(12.5);
    await page.getByText('Game progress · replay gold timeline',{exact:true}).click();
    const timeline=page.getByLabel('Replay gold timeline CSV'),points=[{timeSeconds:120,blueGold:3500,redGold:3600},{timeSeconds:300,blueGold:11000,redGold:11200}];
    await h.send({type:'post_game_gold_timeline',reportId:report.id,points});await expect(timeline).toHaveValue(timelineToText(points));
    const draft='02:00,4000,4100\n05:00,12000,12500\n10:00,25000,26000';await timeline.fill(draft);
    const changed=[{timeSeconds:120,blueGold:3600,redGold:3700},{timeSeconds:300,blueGold:11500,redGold:11700}];
    await h.send({type:'post_game_gold_timeline',reportId:report.id,points:changed});await expect(timeline).toHaveValue(draft);
    await expect(page.getByText(/The saved timeline changed/)).toBeVisible();await page.getByRole('button',{name:'Reload saved timeline',exact:true}).click();await expect(timeline).toHaveValue(timelineToText(changed));
    await timeline.fill(draft);await page.getByRole('button',{name:'Save timeline',exact:true}).click();await expect.poll(()=>h.state().postGameReports[0].goldTimeline?.length).toBe(3);await expect(page.getByText('Timeline saved.',{exact:true})).toBeVisible();
    await expect(page.getByLabel('Post-game OCR source page').locator('option[value="recap"]')).toHaveCount(0);
  }finally{h.close();}
});

test('backup controls recover from failures, reject broken exports and time out without duplicate requests',async({page,baseURL})=>{
  const h=await harness(baseURL);let mode:'fail'|'backup'|'invalid-export'|'hang'='fail',calls=0,held:Route|undefined;
  try{
    await h.send({type:'reset_match'});await h.send({type:'settings',settings:{...initialState(),language:'eng'}});
    await page.route('**/api/recovery',route=>{
      calls++;
      if(mode==='hang'){held=route;return;}
      return route.fulfill(mode==='backup'?{status:201,json:{file:'backup-test.json'}}:{status:500,json:{error:'Storage temporarily unavailable'}});
    });
    await page.route('**/api/match-export',route=>route.fulfill({json:{format:'invalid',entries:[]}}));
    await page.goto('/control');await page.getByText('Backup and recovery',{exact:true}).click();
    const panel=page.getByText('Backup and recovery',{exact:true}).locator('..');
    await panel.getByRole('button',{name:'Backup status',exact:true}).click();await expect(panel.getByRole('alert')).toHaveText('Storage temporarily unavailable');
    mode='backup';await panel.getByRole('button',{name:'Back up now',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});await expect(panel.getByRole('status')).toHaveText('Backup saved.');expect(calls).toBe(2);
    mode='invalid-export';await panel.getByRole('button',{name:'Export match',exact:true}).click();await expect(panel.getByRole('alert')).toHaveText('The export is incomplete. Please retry.');
    mode='hang';await page.clock.install();await panel.getByRole('button',{name:'Backup status',exact:true}).click();await expect(panel.getByRole('button',{name:'Checking…',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Back up now',exact:true})).toBeDisabled();
    await expect.poll(()=>!!held).toBe(true);await page.clock.fastForward(30001);await expect(panel.getByRole('alert')).toContainText('Request timed out');await expect(panel.getByRole('button',{name:'Backup status',exact:true})).toBeEnabled();expect(calls).toBe(3);
  }finally{if(held)await held.abort().catch(()=>{});h.close();}
});
