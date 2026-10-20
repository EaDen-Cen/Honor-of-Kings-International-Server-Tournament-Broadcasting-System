import {test,expect} from './fixtures';
import {harness} from './harness';
import {initialState} from '../src/shared/types';
import {phases} from '../src/shared/types';
import {simulatorSlotForPhase,simulatorSlotKey} from '../src/simulator/bpSimulatorModel';

test('GHUD retains blue-left metrics while draft keeps registered slot roles after a color swap',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});
    const state=initialState();state.language='eng';state.sideSwapMode='colorsOnly';state.banCount=0;
    state.blueTeam.name='Alpha team';state.redTeam.name='Bravo team';state.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];state.blueTeam.playerRoles=['jungle','roam','mid','farm','clash'];
    await h.send({type:'settings',settings:state});
    await h.send({type:'set_player_slot_order',side:'blue',order:[1,0,2,3,4],expectedPlayers:state.blueTeam.players});
    await h.send({type:'swap_sides'});await h.fill();
    await h.send({type:'live_game_stats',stats:{...h.state().liveGameStats,density:'full',blueGold:12300,redGold:14200}});
    await page.setViewportSize({width:1920,height:1080});await page.goto('/overlay/game-hud');
    const hud=page.getByTestId('game-hud');
    const left=hud.getByTestId('game-hud-blue-team'),right=hud.getByTestId('game-hud-red-team');
    await expect(left.locator('strong')).toHaveText('Bravo team');
    await expect(right.locator('strong')).toHaveText('Alpha team');
    expect(await left.locator('strong').evaluate(element=>element.clientHeight>=element.scrollHeight)).toBe(true);
    await expect(hud.getByTestId('game-hud-blue-gold')).toContainText('12.3k');
    await expect(hud.getByTestId('game-hud-red-gold')).toContainText('14.2k');
    await expect(hud.locator('.game-hud-rosters')).toHaveCount(0);
    const leftBox=await left.boundingBox(),rightBox=await right.boundingBox();
    expect(leftBox!.x).toBeLessThan(rightBox!.x);
    await page.screenshot({path:'artifacts/full-audit/ghud-sides-and-roles.png',omitBackground:true});
    // The compact HUD intentionally has no player roster. Verify identity and
    // registered roles on the draft overlay that actually presents them.
    await page.goto('/overlay/draft');
    const card=page.locator(`.broadcast-card[data-team-id="${state.blueTeam.id}"][data-slot="0"]`);
    await expect(card.locator('.player-id')).toHaveText('Bravo');
    await expect(card.getByRole('img',{name:'Roaming',exact:true})).toBeVisible();
  }finally{h.close();}
});

test('Simulator stepping back unlocks the correct turn for zero and five bans',async({page})=>{
  for(const banCount of [0,5] as const){
    const phaseIndex=banCount===0?3:16;
    const locked=phases('match','blue',banCount).slice(0,phaseIndex).map((_,index)=>simulatorSlotKey(simulatorSlotForPhase('match','blue',index,banCount)!));
    await page.goto('/tools/bp-simulator-control');
    await page.evaluate(state=>localStorage.setItem('hok-bp-simulator-state-v3',JSON.stringify(state)),{mode:'match',banCount,phaseIndex,locked,autoPlay:false,testMode:'bp'});
    await page.reload();
    await page.getByRole('button',{name:'← 上一步',exact:true}).click();
    await expect(page.locator('.sim-phase-readout')).toContainText('PRESELECT');
    await expect(page.getByRole('button',{name:'锁定当前组',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'下一轮 →',exact:true})).toBeDisabled();
  }
});

test('external settings changes merge untouched form fields and keep unsaved operator edits',async({page,baseURL})=>{
  const h=await harness(baseURL);
  try{
    await h.send({type:'reset_match'});await h.send({type:'settings',settings:{...initialState(),language:'eng'}});
    await page.goto('/control');await page.getByRole('button',{name:'Team settings',exact:true}).click();
    const teams=page.locator('.team-settings-grid > section'),name=teams.first().locator('input').first();
    await name.fill('Unsaved operator team');
    const incoming=h.state();incoming.redTeam.name='Remote opponent';
    await h.send({type:'settings',settings:incoming});
    await expect(name).toHaveValue('Unsaved operator team');await expect(teams.nth(1).locator('input').first()).toHaveValue('Remote opponent');
    await page.locator('.team-settings-panel').getByRole('button',{name:'Save settings',exact:true}).click();
    await expect.poll(()=>h.state().blueTeam.name).toBe('Unsaved operator team');expect(h.state().redTeam.name).toBe('Remote opponent');
    await name.fill('Another unsaved team');
    const concurrent=h.state();concurrent.blueTeam.logo='/test-remote-logo.png';await h.send({type:'settings',settings:concurrent});
    const teamSettings=page.locator('.team-settings-panel');
    await expect(name).toHaveValue('Another unsaved team');
    await expect(teamSettings.getByRole('alert')).toContainText('changed in another page');
    await expect(teamSettings.getByRole('button',{name:'Save settings',exact:true})).toBeDisabled();
    await teamSettings.getByRole('button',{name:'Reload settings',exact:true}).click();
    await expect(name).toHaveValue('Unsaved operator team');
    await expect(teams.first().getByRole('textbox',{name:'Team logo URL',exact:true})).toHaveValue('/test-remote-logo.png');
    await page.getByRole('button',{name:'Close team settings',exact:true}).click();
    await page.getByRole('button',{name:'Match settings',exact:true}).click();
    const settings=page.locator('.match-settings-panel'),stage=settings.locator('input[maxlength="80"]');
    await stage.fill('Unsaved final stage');
    await h.send({type:'settings',settings:{...h.state(),scoreDisplay:'boxes'}});
    await expect(stage).toHaveValue('Unsaved final stage');
    await settings.getByRole('button',{name:'Save settings',exact:true}).click();
    await expect.poll(()=>h.state().stage).toBe('Unsaved final stage');expect(h.state().scoreDisplay).toBe('boxes');
  }finally{h.close();}
});
