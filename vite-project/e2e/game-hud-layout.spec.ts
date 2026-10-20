import { test,expect } from './fixtures';
import { harness } from './harness';
import { initialState } from '../src/shared/types';

test('GHUD is a transparent KPL-inspired top ribbon and never masks the minimap or bottom gameplay',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    const state=initialState();
    state.language='eng';
    state.blueTeam.name='BLUE TEST';
    state.redTeam.name='RED TEST';
    await h.send({type:'settings',settings:state});
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,blueKills:7,redKills:5,blueTowers:2,redTowers:3,blueGold:15300,redGold:14100,gameTimeSeconds:652,density:'compact'}});
    await page.setViewportSize({width:1920,height:1080});
    await page.goto('/overlay/game-hud');
    const hud=page.getByTestId('game-hud');
    await expect(hud).toBeVisible();
    await expect.poll(async()=>Math.round((await page.getByTestId('game-hud-ribbon').boundingBox())?.width??0)).toBe(1248);
    await expect(hud.getByTestId('game-hud-blue-kills')).toContainText('7');
    await expect(hud.getByTestId('game-hud-red-kills')).toContainText('5');
    await expect(hud.locator('.game-hud-clock')).toHaveText('10:52');
    await expect(hud.getByTestId('game-hud-blue-gold')).toContainText('15.3k');
    await expect(hud.getByTestId('game-hud-red-gold')).toContainText('14.1k');
    await expect(hud.getByTestId('game-hud-single-row').locator(':scope > *')).toHaveCount(13);
    await expect(hud.locator('.game-hud-rosters')).toHaveCount(0);
    await expect(hud.locator('[class*="opaque"],.game-hud-map-cover,.game-hud-lineup')).toHaveCount(0);
    const geometry=await hud.evaluate(node=>{
      const top=node.querySelector('.game-hud-scoreboard')!.getBoundingClientRect();
      const root=node.getBoundingClientRect();
      return {height:top.height,rootHeight:root.height,rootBg:getComputedStyle(node).backgroundColor};
    });
    expect(geometry.height).toBeLessThanOrEqual(101);
    expect(geometry.rootHeight).toBe(1080);
    expect(geometry.rootBg).toBe('rgba(0, 0, 0, 0)');
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,density:'full'}});
    await expect(hud.getByTestId('game-hud-objective-status')).toBeVisible();
    await expect(hud.locator('.game-hud-rosters')).toHaveCount(0);
    const height=await hud.locator('.game-hud-scoreboard').evaluate(node=>node.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(133);
  }finally{h.close();}
});

test('director can scale the GHUD width while OBS stays 1920×1080 and setting persists',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    const state=initialState();state.language='eng';
    await h.send({type:'settings',settings:state});
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,widthPercent:80}});
    await page.setViewportSize({width:1920,height:1080});
    await page.goto('/overlay/game-hud');
    const hud=page.getByTestId('game-hud'),ribbon=page.getByTestId('game-hud-ribbon');
    await expect(hud).toBeVisible();
    await expect.poll(async()=>{
      const rect=await ribbon.boundingBox();
      return rect?{x:Math.round(rect.x),width:Math.round(rect.width)}:null;
    }).toEqual({x:192,width:1536});
    expect(await hud.evaluate(el=>el.getBoundingClientRect().width)).toBe(1920);
    await page.reload();
    await expect.poll(async()=>Math.round((await ribbon.boundingBox())?.width??0)).toBe(1536);
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,density:'full'}});
    await expect(ribbon.getByTestId('game-hud-objective-status')).toBeVisible();
    await expect(ribbon.locator('.game-hud-rosters')).toHaveCount(0);
    expect(Math.round((await ribbon.boundingBox())!.width)).toBe(1536);
    await page.goto('/control#token=e2e-control');
    await page.getByText('Live HUD / kills, towers and objectives',{exact:true}).click();
    const slider=page.getByRole('slider',{name:'HUD width'});
    await expect(slider).toHaveValue('80');
    await expect(page.getByText('HUD width · 80% (1536px)')).toBeVisible();
    await slider.focus();
    await slider.press('Home');
    await expect.poll(()=>h.state().liveGameStats.widthPercent).toBe(50);
    await page.getByRole('button',{name:'Reset to 65%'}).click();
    await expect.poll(()=>h.state().liveGameStats.widthPercent).toBe(65);
    const heightSlider=page.getByRole('slider',{name:'HUD height'});
    await expect(heightSlider).toHaveValue('132');
    await heightSlider.focus();
    await heightSlider.press('Home');
    await expect.poll(()=>h.state().liveGameStats.heightPx).toBe(64);
    await page.getByRole('button',{name:'Reset height to 132px'}).click();
    await expect.poll(()=>h.state().liveGameStats.heightPx).toBe(132);
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,widthPercent:75}});
    await h.send({type:'reset_match'});
    expect(h.state().liveGameStats.widthPercent).toBe(75);
  }finally{h.close();}
});

test('full GHUD second row shows manually verified boss presence without hero lineup',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,density:'full',
      neutralObjectives:[{id:'tyrant',name:'Tyrant',icon:'',blue:2,red:1,status:'alive'},
        {id:'overlord',name:'Overlord',icon:'',blue:0,red:1,status:'down'}]}});
    await page.setViewportSize({width:1920,height:1080});
    await page.goto('/overlay/game-hud');
    const hud=page.getByTestId('game-hud');
    await expect(hud.getByTestId('game-hud-blue-objectives')).toContainText('2');
    await expect(hud.getByTestId('game-hud-red-objectives')).toContainText('2');
    await expect(hud.getByTestId('game-hud-objective-status')).toContainText('ALIVE');
    await expect(hud.getByTestId('game-hud-objective-status')).toContainText('DOWN');
    await expect(hud.locator('.game-hud-rosters,.game-hud-player')).toHaveCount(0);
  }finally{h.close();}
});
