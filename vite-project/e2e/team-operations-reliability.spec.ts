import { test, expect } from './fixtures';
import { harness } from './harness';

test('saved team remains successful when library refresh becomes unavailable',async({page,request,baseURL})=>{
  const match=await harness(baseURL);
  const name=`Saved without refresh ${Date.now()}`;
  try{
    await match.send({type:'reset_match'});
    await match.send({type:'settings',settings:{...match.state(),language:'eng'}});
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button',{name:'Team settings',exact:true}).click();
    await page.getByRole('button',{name:'Manage saved teams',exact:true}).click();
    const manager=page.locator('.library-dialog');
    await manager.getByLabel('Team name',{exact:true}).fill(name);
    let failedRefreshes=0;
    await page.route('**/api/team-presets',async route=>{
      if(route.request().method()==='GET'){
        failedRefreshes++;
        await route.fulfill({status:503,json:{error:'presetSaveFailed'}});
      }else await route.continue();
    });
    await manager.getByRole('button',{name:'Save team',exact:true}).click();
    await expect(manager.locator('.library-status')).toHaveText('Team saved');
    await expect(manager.getByRole('button',{name,exact:true})).toBeVisible();
    expect(failedRefreshes).toBe(0);
    const saved=await (await request.get('/api/team-presets',{headers:{Authorization:'Bearer e2e-control'}})).json();
    expect(saved.teams.filter((team:{name:string})=>team.name===name)).toHaveLength(1);
  }finally{match.close();}
});

test('closing during portrait upload releases the editor and ignores its late response',async({page,baseURL})=>{
  const match=await harness(baseURL);
  let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let started=false;
  try{
    await match.send({type:'reset_match'});
    await match.send({type:'settings',settings:{...match.state(),language:'eng'}});
    page.on('dialog',dialog=>dialog.accept());
    await page.route('**/api/uploads/player-portrait',async route=>{
      started=true;
      await gate;
      await route.fulfill({status:201,json:{url:'/late-upload.png'}}).catch(()=>{});
    });
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button',{name:'Team settings',exact:true}).click();
    await page.getByRole('button',{name:'Manage saved teams',exact:true}).click();
    const manager=page.locator('.library-dialog');
    await manager.getByLabel('Team name',{exact:true}).fill('Unsaved upload');
    await manager.getByLabel('Choose image',{exact:true}).first().setInputFiles('e2e/fixtures/player-test.png');
    await expect.poll(()=>started).toBe(true);
    await expect(manager.getByRole('button',{name:'Save team',exact:true})).toBeDisabled();
    await manager.getByRole('button',{name:'Close team library',exact:true}).click();
    await expect(manager).toHaveCount(0);
    await page.getByRole('button',{name:'Manage saved teams',exact:true}).click();
    await manager.getByLabel('Team name',{exact:true}).fill('New upload draft');
    await expect(manager.getByRole('button',{name:'Save team',exact:true})).toBeEnabled();
    release();
    await expect(manager.getByLabel('Player portrait URL',{exact:true}).first()).toHaveValue('');
    await expect(manager.getByRole('button',{name:'Save team',exact:true})).toBeEnabled();
  }finally{release();match.close();}
});

test('the team editor retains changes when discard is declined',async({page,baseURL})=>{
  const match=await harness(baseURL);
  try{
    await match.send({type:'reset_match'});
    await match.send({type:'settings',settings:{...match.state(),language:'eng'}});
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button',{name:'Team settings',exact:true}).click();
    await page.getByRole('button',{name:'Manage saved teams',exact:true}).click();
    const manager=page.locator('.library-dialog');
    await manager.getByLabel('Team name',{exact:true}).fill('Keep this draft');
    page.once('dialog',dialog=>dialog.dismiss());
    await manager.getByRole('button',{name:'Close team library',exact:true}).click();
    await expect(manager).toBeVisible();
    await expect(manager.getByLabel('Team name',{exact:true})).toHaveValue('Keep this draft');
    page.once('dialog',dialog=>dialog.dismiss());
    await manager.getByRole('button',{name:'New team',exact:true}).click();
    await expect(manager.getByLabel('Team name',{exact:true})).toHaveValue('Keep this draft');
  }finally{match.close();}
});

test('manual final-lineup adjustments pause automatic synchronization',async({page,baseURL})=>{
  const match=await harness(baseURL);
  try{
    await match.send({type:'reset_match'});
    await match.send({type:'settings',settings:{...match.state(),language:'eng',bpInputMode:'screen'}});
    await match.fill();
    const picks=[...match.state().bluePicks];
    await page.goto('/control#token=e2e-control');
    const panel=page.locator('.lineup-sync');
    const automatic=panel.getByRole('checkbox',{name:'Automatically detect and sync hero swaps',exact:true});
    await expect(automatic).toBeChecked();
    await panel.locator('.lineup-team.blue select').first().selectOption(String(picks[1]));
    await expect.poll(()=>match.state().blueAssignments).toEqual([picks[1],picks[0],...picks.slice(2)]);
    await expect(automatic).not.toBeChecked();
    expect(await page.evaluate(()=>localStorage.getItem('hok-lineup-auto'))).toBe('0');
    await panel.getByRole('button',{name:'Reset to pick order',exact:true}).click();
    await expect.poll(()=>match.state().blueAssignments).toEqual(picks);
  }finally{match.close();}
});
