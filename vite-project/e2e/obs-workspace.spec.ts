import {test,expect} from './fixtures';
import {harness} from './harness';
import {phases} from '../src/shared/types';
import {heroesForPool} from '../src/shared/heroPool';
import {banRestriction,pickRestriction} from '../src/shared/draftRules';

test('OBS workspace suggests BP from Control state but switches only after operator clicks Take',async({page,baseURL})=>{
  const match=await harness(baseURL);
  let programScene='Waiting';
  const changes:string[]=[];
  await page.route('**/api/v1/obs/status',route=>route.fulfill({json:{
    configured:true,connected:true,scenes:['Waiting','BP','Game','MVP'],programScene,recording:true,
  }}));
  await page.route('**/api/v1/obs/audio',route=>route.fulfill({json:{inputs:[]}}));
  await page.route('**/api/v1/obs/scene',async route=>{
    const body=route.request().postDataJSON() as {scene:string};
    changes.push(body.scene);programScene=body.scene;
    await route.fulfill({json:{configured:true,connected:true,scenes:['Waiting','BP','Game','MVP'],programScene,recording:true}});
  });
  await page.route('**/api/v1/obs/layout?*',route=>route.fulfill({json:{scene:'BP',sources:[
    {name:'BP Overlay',enabled:true,index:0,width:1920,height:1080},
    {name:'Small Source',enabled:true,index:1,width:1280,height:720},
  ]}}));
  try{
    await match.send({type:'reset_match'});
    await page.goto('/control#token=e2e-control');
    const panel=page.getByTestId('obs-director');
    await panel.locator(':scope > summary').click();
    await expect(panel.getByTestId('obs-cue-waiting')).toHaveClass(/is-recommended/);
    const state=match.state();
    const phase=phases(state.draftMode,state.firstPickSide,state.banCount)[0];
    const hero=heroesForPool(state.heroPool).find(h=>phase.action==='ban'
      ?!banRestriction(state,phase.team,h.id)
      :!pickRestriction(state,phase.team,state[`${phase.team}Picks`].length,h.id));
    if(!hero)throw new Error('No legal hero for first draft action');
    await match.send({type:'draft_action',team:phase.team,action:phase.action,heroId:hero.id});
    await expect(panel.getByTestId('obs-cue-draft')).toHaveClass(/is-recommended/);
    expect(changes).toEqual([]); // Never auto-switch on OCR or draft changes.
    const buttons=panel.getByTestId('obs-scene-buttons');
    await expect(buttons.getByRole('button',{name:'OBS quick scene BP'})).toBeVisible();
    await panel.getByTestId('obs-cue-draft').getByRole('button',{name:'切换'}).click();
    await expect.poll(()=>changes).toEqual(['BP']);
    await expect(panel.getByTestId('obs-cue-draft').getByRole('button')).toHaveText('播出中');
    await panel.getByTestId('obs-layout-audit').getByRole('button',{name:'检查所选场景的浏览器源布局'}).click();
    await expect(panel.getByTestId('obs-layout-audit')).toContainText('1920 × 1080');
    await expect(panel.getByTestId('obs-layout-audit')).toContainText('1280 × 720');
    await panel.getByRole('combobox',{name:'OBS cue map game'}).selectOption('MVP');
    await page.reload();
    await panel.locator(':scope > summary').click();
    await expect(panel.getByRole('combobox',{name:'OBS cue map game'})).toHaveValue('MVP');
    await panel.getByRole('button',{name:'自定义顺序'}).click();
    await buttons.getByRole('button',{name:'Move MVP up'}).click();
    await expect(buttons.locator('.obs-scene-button-item').nth(2)).toContainText('MVP');
    await page.reload();
    await panel.locator(':scope > summary').click();
    await expect(panel.getByTestId('obs-scene-buttons').locator('.obs-scene-button-item').nth(2)).toContainText('MVP');
    expect(changes).toEqual(['BP']);
  }finally{match.close();}
});
