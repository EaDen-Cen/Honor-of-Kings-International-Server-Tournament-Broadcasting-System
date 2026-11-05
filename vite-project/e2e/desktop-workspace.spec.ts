import { test, expect } from './fixtures';
import { openDockPanel } from './dockNavigation';
test('desktop menus overlay a full-height workspace; floating preflight preserves checks and status', async ({ page }) => {
  await page.goto('/control#token=e2e-control');
  const bar = page.getByRole('navigation', { name: '应用菜单' });
  for (const [width,height] of [[1920,1080],[1440,900],[1024,768]]) {
    await page.setViewportSize({width,height});
    await expect(bar).toBeVisible();
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(40);
    const before = (await page.locator('.dock-layout').boundingBox())!;
    expect(before.y).toBeLessThan(60);
    await openDockPanel(page,'preparation');
    expect((await page.locator('.dock-layout').boundingBox())!.y).toBe(before.y);
    await page.locator('.desktop-menu').getByText('窗口',{exact:true}).click();
  }
  const checklist = page.getByLabel('开播强提醒',{exact:true});
  await checklist.locator('summary').first().click();
  const check = checklist.getByRole('checkbox').first();
  await check.check();
  await page.getByRole('button',{name:'浮动 赛前准备',exact:true}).click();
  const floating = page.getByRole('dialog',{name:'赛前准备',exact:true});
  await expect(floating).toBeVisible();
  await expect(check).toBeChecked();
  await floating.getByRole('button',{name:'关闭 / Close',exact:true}).click();
  await expect(floating).toHaveCount(0);
  await expect(page.getByLabel('Preflight summary')).toContainText('待检查');
  await openDockPanel(page,'preparation');
  await expect(check).toBeChecked();
  await page.locator('.window-menu > summary').click();
  await page.screenshot({path:'artifacts/desktop-workspace.png'});
});
