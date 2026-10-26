import { test,expect } from './fixtures';
import { harness } from './harness';
import { initialState } from '../src/shared/types';

test('team library download and preview imported package before choosing conflict policy',async ({page,request,baseURL})=>{
  const h = await harness(baseURL);
  const headers = {Authorization:'Bearer e2e-control'};
  try {
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...h.state(),language:'eng'}});
    const saved = await request.post('/api/team-presets',{headers,
      data:{...initialState().blueTeam,name:'Portable team test'}});
    expect(saved.ok()).toBeTruthy();
    page.on('dialog',dialog=>dialog.accept());
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button',{name:'Team settings',exact:true}).click();
    await page.getByRole('button',{name:'Manage saved teams',exact:true}).click();
    const transfer = page.locator('.team-library-transfer');
    await expect(transfer.getByRole('button',{name:'Export full library'})).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      transfer.getByRole('button',{name:'Export full library'}).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^hok-team-library-.*\.json$/);
    const downloaded = await download.path();
    expect(downloaded).not.toBeNull();
    await transfer.locator('input[type=file]').setInputFiles(downloaded!);
    await expect(transfer.locator('.transfer-preview')).toContainText('Validated:');
    await expect(transfer.locator('.transfer-preview')).toContainText('existing');
    await transfer.getByRole('button',{name:'Confirm import'}).click();
    await expect(transfer.getByRole('status')).toContainText('Import complete:');
    const current = await (await request.get('/api/team-presets',{headers})).json();
    expect(current.teams.some((team:{name:string})=>team.name==='Portable team test')).toBeTruthy();
  } finally {h.close();}
});
