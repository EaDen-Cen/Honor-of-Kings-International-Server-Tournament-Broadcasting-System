import { test,expect,type Page } from './fixtures';
import { harness } from './harness';
import { startMockObs } from '../server/testHelpers/mockObs';
import { defaultObsConfig,OBS_PRESET_IDS,type ObsPresetId,type ObsSnapshot } from '../src/shared/obsProtocol';
import { initialState } from '../src/shared/types';

const authorization={Authorization:'Bearer e2e-control'};
type MockObs=Awaited<ReturnType<typeof startMockObs>>;
const names:Record<ObsPresetId,string>={waiting:'Waiting',bp:'Draft',game:'Game',pause:'Pause',postgame:'Postgame','matchup-clash':'Clash','matchup-jungle':'Jungle','matchup-mid':'Mid','matchup-farm':'Farm','matchup-roam':'Roam',mvp:'MVP',safe:'Safe'};

async function prepare(page:Page,baseURL:string|undefined,obs:MockObs,connect=false){
  const match=await harness(baseURL);
  try{const state=initialState();state.language='eng';await match.send({type:'settings',settings:state});}finally{match.close();}
  obs.state.scenes=[...Object.values(names)];
  const {passwordConfigured,...config}=defaultObsConfig();void passwordConfigured;
  config.enabled=true;config.url=obs.url;config.inputs={game:'GameAudio',caster:'Mic',bgm:'Music',sfx:'SFX'};
  for(const id of OBS_PRESET_IDS)config.presets[id].sceneName=names[id];
  const saved=await page.request.put('/api/obs/config',{headers:authorization,data:{...config,password:obs.password}});
  expect(saved.ok()).toBe(true);
  const publicConfig=await saved.json();expect(publicConfig.passwordConfigured).toBe(true);
  expect(publicConfig).not.toHaveProperty('password');expect(JSON.stringify(publicConfig)).not.toContain(obs.password);
  if(connect){const response=await page.request.post('/api/obs/connect',{headers:authorization});expect(response.ok()).toBe(true);}
  await page.goto('/control#token=e2e-control');
  const panel=page.locator('.obs-director');
  await expect(panel).toHaveAttribute('data-obs-connection',connect?'connected':'disconnected');
  return panel;
}
async function snapshot(page:Page):Promise<ObsSnapshot>{
  const response=await page.request.get('/api/obs',{headers:authorization});expect(response.ok()).toBe(true);return response.json() as Promise<ObsSnapshot>;
}

test('OBS director connects through the real server, confirms actual scenes and reads recording without controlling it',async({page,baseURL})=>{
  const obs=await startMockObs();
  try{
    const panel=await prepare(page,baseURL,obs);
    await panel.getByRole('button',{name:'Connect OBS',exact:true}).click();
    await expect(panel).toHaveAttribute('data-obs-connection','connected');
    await expect(panel.locator('.obs-program strong')).toHaveText('Waiting');
    await expect(panel.locator('[data-obs-output="recording"] strong')).toHaveText('Active');
    await expect(panel.locator('[data-obs-output="recording"] small')).toHaveText('00:00:10');
    await expect(panel.locator('[data-obs-output="streaming"] strong')).toHaveText('Active');
    await expect(panel.locator('[data-obs-preset="game"]')).toBeDisabled();
    await expect(panel.locator('.obs-game-readiness')).toContainText('Complete the current draft');
    await panel.locator('[data-obs-preset="bp"]').click();
    await expect(panel.locator('[data-obs-command-state="succeeded"]')).toContainText('OBS confirmed');
    await expect(panel.locator('.obs-program strong')).toHaveText('Draft');
    expect(obs.state.scene).toBe('Draft');
    obs.manualScene('MVP');await expect(panel.locator('.obs-program strong')).toHaveText('MVP');
    const actual=await snapshot(page);expect(actual.status.sceneName).toBe('MVP');
    expect(JSON.stringify(actual)).not.toContain(obs.password);
    await panel.getByRole('button',{name:'Disconnect control',exact:true}).click();
    await expect(panel).toHaveAttribute('data-obs-connection','disconnected');
    expect(obs.state.recording).toBe(true);expect(obs.state.streaming).toBe(true);
    expect(obs.requests.filter(request=>/^(Start|Stop)(Record|Stream)$/.test(request.requestType))).toHaveLength(0);
    const caster=await page.request.get('/api/obs',{headers:{Authorization:'Bearer e2e-caster'}});
    expect(caster.status()).toBe(403);
  }finally{await obs.close();}
});

test('polling and malformed OBS responses retain form edits and recover without accepting partial telemetry',async({page,baseURL})=>{
  const obs=await startMockObs();
  try{
    const panel=await prepare(page,baseURL,obs,true);
    await panel.locator('.obs-settings > summary').click();
    const password=panel.getByLabel('OBS WebSocket password',{exact:true}),address=panel.getByLabel('OBS WebSocket address',{exact:true});
    await expect(password).toHaveAttribute('type','password');await expect(password).toHaveValue('');
    const pendingPassword='unsaved-obs-password';await password.fill(pendingPassword);
    await panel.getByRole('button',{name:'Refresh status',exact:true}).click();
    await expect(password).toHaveValue(pendingPassword);await expect(address).toHaveValue(obs.url);
    const browserStorage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));
    expect(JSON.stringify(browserStorage)).not.toContain(pendingPassword);expect(JSON.stringify(browserStorage)).not.toContain(obs.password);
    await page.route('**/api/obs',route=>route.fulfill({json:{config:{},status:{}}}));
    await panel.getByRole('button',{name:'Refresh status',exact:true}).click();
    await expect(panel).toHaveAttribute('data-obs-connection','unknown');
    await expect(panel).toContainText('Could not read OBS status');await expect(password).toHaveValue(pendingPassword);
    await expect(panel.locator('[data-obs-preset="bp"]')).toBeDisabled();
    await page.unroute('**/api/obs');await panel.getByRole('button',{name:'Refresh status',exact:true}).click();
    await expect(panel).toHaveAttribute('data-obs-connection','connected');await expect(password).toHaveValue(pendingPassword);
    const changed=await page.request.put('/api/obs/config',{headers:authorization,data:{lowDiskGb:20}});expect(changed.ok()).toBe(true);
    await panel.getByRole('button',{name:'Refresh status',exact:true}).click();
    await expect(panel).toContainText('Saved setup changed elsewhere');await expect(panel.getByRole('button',{name:'Save OBS settings',exact:true})).toBeDisabled();
    await panel.getByRole('button',{name:'Reload saved settings',exact:true}).click();await expect(password).toHaveValue('');
    const bpScene=panel.getByLabel('BP scene',{exact:true});await bpScene.selectOption('MVP');
    await expect(panel.getByLabel('BGM audio input',{exact:true})).not.toContainText('Camera');
    await panel.getByRole('button',{name:'Save OBS settings',exact:true}).click();
    await expect(panel).toHaveAttribute('data-obs-connection','connected');
    await expect.poll(async()=>(await snapshot(page)).config.presets.bp.sceneName).toBe('MVP');
    expect(obs.state.scene).toBe('Waiting');
  }finally{await obs.close();}
});

test('BGM mute and Safe can interrupt an in-progress fade while recording and streaming continue',async({page,baseURL})=>{
  const obs=await startMockObs();
  try{
    const panel=await prepare(page,baseURL,obs,true);
    const target=panel.getByLabel('BGM target volume',{exact:true});
    await expect(target).toHaveValue('50');
    await panel.getByLabel('BGM fade duration',{exact:true}).selectOption('0');
    await panel.getByRole('button',{name:'Fade BGM out',exact:true}).click();
    await expect.poll(()=>obs.state.volumes.Music).toBe(0);
    await expect(panel.getByRole('button',{name:'Fade BGM in',exact:true})).toBeEnabled();
    await panel.getByRole('button',{name:'Refresh status',exact:true}).click();
    await expect(panel.locator('.obs-bgm small')).toHaveText('Muted');
    await expect(target).toHaveValue('50');
    await panel.getByRole('button',{name:'Fade BGM in',exact:true}).click();
    await expect.poll(()=>obs.state.volumes.Music).toBe(.5);
    await expect(panel.getByRole('button',{name:'Fade BGM out',exact:true})).toBeEnabled();
    await panel.getByLabel('BGM fade duration',{exact:true}).selectOption('3000');
    const previousVolumeWrites=obs.requests.filter(request=>request.requestType==='SetInputVolume').length;
    await panel.getByRole('button',{name:'Fade BGM out',exact:true}).click();
    await expect.poll(()=>obs.requests.filter(request=>request.requestType==='SetInputVolume').length).toBeGreaterThan(previousVolumeWrites);
    await expect(panel.getByRole('button',{name:'Fade BGM in',exact:true})).toBeDisabled();
    const mute=panel.getByRole('button',{name:'Mute BGM',exact:true});await expect(mute).toBeEnabled();await mute.click();
    await expect.poll(()=>obs.state.muted.Music).toBe(true);
    await expect(panel.locator('[data-obs-command-state="succeeded"]')).toBeVisible();
    await panel.getByRole('button',{name:'Fade BGM in',exact:true}).click();
    await expect(panel.getByRole('button',{name:'Fade BGM in',exact:true})).toBeDisabled();
    const safe=panel.locator('[data-obs-preset="safe"]');await expect(safe).toBeEnabled();await safe.click();
    await expect(panel.locator('.obs-program strong')).toHaveText('Safe');
    await expect(panel.locator('[data-obs-command-state="succeeded"]')).toBeVisible();
    expect(obs.state.muted.Music).toBe(true);expect(obs.state.muted.SFX).toBe(true);
    expect(obs.state.recording).toBe(true);expect(obs.state.streaming).toBe(true);
    expect(obs.requests.filter(request=>/^(Start|Stop)(Record|Stream)$/.test(request.requestType))).toHaveLength(0);
  }finally{await obs.close();}
});

test('a lost command HTTP response can only be confirmed by its matching actual server command result',async({page,baseURL})=>{
  const obs=await startMockObs();let release=()=>{};
  try{
    const panel=await prepare(page,baseURL,obs,true);
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const commands:Array<{id:string;type:string}>=[];
    await page.route('**/api/obs/command',async route=>{
      commands.push(route.request().postDataJSON());
      await route.fetch();await gate;
      await route.abort().catch(()=>{});
    });
    await panel.locator('[data-obs-preset="bp"]').click();
    await expect.poll(()=>commands.length).toBe(1);
    await expect(panel.locator('[data-obs-command-state="sending"]')).toBeVisible();
    await expect(panel.locator('.obs-program strong')).toHaveText('Draft');
    await expect(panel.locator('[data-obs-command-state="succeeded"]')).toBeVisible();
    await expect(panel.locator('[data-obs-preset="mvp"]')).toBeEnabled();
    const actual=await snapshot(page);expect(actual.status.lastCommand?.id).toBe(commands[0].id);expect(actual.status.lastCommand?.status).toBe('succeeded');
    const sceneRequests=obs.requests.filter(request=>request.requestType==='SetCurrentProgramScene').length;
    const duplicate=await page.request.post('/api/obs/command',{headers:authorization,data:{...commands[0],preset:'bp'}});expect(duplicate.ok()).toBe(true);
    expect(obs.requests.filter(request=>request.requestType==='SetCurrentProgramScene')).toHaveLength(sceneRequests);
    expect(commands).toHaveLength(1);
  }finally{release();await obs.close();}
});

test('Game requires real saved P1–P5 verification and rejects a stale roster in both the UI and direct API',async({page,baseURL})=>{
  const obs=await startMockObs(),match=await harness(baseURL);
  try{
    const panel=await prepare(page,baseURL,obs,true);
    const state=initialState();state.language='eng';state.bpInputMode='manual';state.banCount=0;
    state.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];state.redTeam.players=['Foxtrot','Golf','Hotel','India','Juliet'];
    state.blueTeam.playerRoles=['clash','jungle','mid','farm','roam'];state.redTeam.playerRoles=['clash','jungle','mid','farm','roam'];
    await match.send({type:'settings',settings:state});await match.fill();
    const game=panel.locator('[data-obs-preset="game"]');await expect(game).toBeDisabled();
    await expect(panel.locator('.obs-game-readiness')).toContainText('Verify both teams');
    const check=page.locator('.operator-game-preflight');await check.screenshot({path:'artifacts/obs-director-20261019/game-preflight-blocked.png'});
    await page.getByRole('button',{name:'Verify current P1–P5',exact:true}).click();
    await expect(page.locator('[data-player-id-verified="true"]')).toHaveText('Both teams server verified');
    await expect(page.locator('.player-id-write-status')).toHaveText('Verification saved · server confirmed');
    await expect(game).toBeEnabled();await game.click();
    await expect(panel.locator('.obs-program strong')).toHaveText('Game');
    await expect(panel.locator('[data-obs-command-state="succeeded"]')).toContainText('OBS confirmed');
    expect(obs.state.scene).toBe('Game');
    const saved=await snapshot(page);expect(saved.status.sceneName).toBe('Game');expect(saved.status.lastCommand?.status).toBe('succeeded');
    await panel.screenshot({path:'artifacts/obs-director-20261019/obs-connected.png'});
    await page.setViewportSize({width:390,height:844});
    await panel.screenshot({path:'artifacts/obs-director-20261019/obs-mobile.png'});
    await page.setViewportSize({width:1440,height:1000});
    obs.manualScene('Waiting');await expect(panel.locator('.obs-program strong')).toHaveText('Waiting');
    const changed=match.state();changed.blueTeam.players[0]='Replacement';await match.send({type:'settings',settings:changed});
    await expect(game).toBeDisabled();await expect(panel.locator('.obs-game-readiness')).toContainText('Verify both teams');
    const before=obs.requests.filter(request=>request.requestType==='SetCurrentProgramScene').length;
    const response=await page.request.post('/api/obs/command',{headers:authorization,data:{id:'stale-roster-game',type:'preset',preset:'game'}});
    expect(response.ok()).toBe(true);const rejected=await response.json();expect(rejected.status).toBe('failed');expect(rejected.message).toContain('Game scene blocked');
    expect(obs.state.scene).toBe('Waiting');expect(obs.requests.filter(request=>request.requestType==='SetCurrentProgramScene')).toHaveLength(before);
    expect(obs.state.recording).toBe(true);expect(obs.state.streaming).toBe(true);
  }finally{match.close();await obs.close();}
});
