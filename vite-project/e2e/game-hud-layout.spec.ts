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
    state.liveGameStats={...state.liveGameStats,blueKills:7,redKills:5,blueTowers:2,redTowers:3,blueGold:15300,redGold:14100,gameTimeSeconds:652,density:'compact'};
    await h.send({type:'settings',settings:state});
    await page.setViewportSize({width:1920,height:1080});
    await page.goto('/overlay/game-hud');
    const hud=page.getByTestId('game-hud');
    await expect(hud).toBeVisible();
    await expect(hud.locator('.game-hud-kills')).toContainText('7');
    await expect(hud.locator('.game-hud-kills')).toContainText('5');
    await expect(hud.locator('.game-hud-clock')).toHaveText('10:52');
    await expect(hud.locator('.game-hud-metrics')).toContainText('15.3k');
    await expect(hud.locator('.game-hud-metrics')).toContainText('14.1k');
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
    const full=h.state();
    full.liveGameStats={...full.liveGameStats,density:'full'};
    await h.send({type:'settings',settings:full});
    await expect(hud.locator('.game-hud-rosters')).toBeVisible();
    const height=await hud.locator('.game-hud-scoreboard').evaluate(node=>node.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(133);
  }finally{h.close();}
});
