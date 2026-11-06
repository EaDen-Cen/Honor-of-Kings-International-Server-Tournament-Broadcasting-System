import { test, expect } from './fixtures';
import { openDockPanel, openWindowMenu } from './dockNavigation';
test('desktop menus overlay a full-height workspace; floating preflight preserves checks and status', async ({
  page,
}) => {
  await page.goto('/control#token=e2e-control');
  const bar = page.getByRole('navigation', { name: '应用菜单' });
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(bar).toBeVisible();
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(40);
    const before = (await page.locator('.dock-layout').boundingBox())!;
    expect(before.y).toBeLessThan(60);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      height,
    );
    await openDockPanel(page, 'preparation');
    expect((await page.locator('.dock-layout').boundingBox())!.y).toBe(before.y);
  }
  const checklist = page.getByLabel('开播强提醒', { exact: true });
  await checklist.locator('summary').first().click();
  const check = checklist.getByRole('checkbox').first();
  await check.check();
  await page.getByRole('button', { name: '浮动 赛前准备', exact: true }).click();
  const floating = page.getByRole('dialog', { name: '赛前准备', exact: true });
  await expect(floating).toBeVisible();
  await expect(check).toBeChecked();
  const beforeMove = (await floating.boundingBox())!;
  const header = (await floating.locator('header').boundingBox())!;
  await page.mouse.move(header.x + 30, header.y + 10);
  await page.mouse.down();
  await page.mouse.move(header.x + 80, header.y + 60, { steps: 5 });
  await page.mouse.up();
  expect((await floating.boundingBox())!.x).toBe(beforeMove.x + 50);
  const beforeResize = (await floating.boundingBox())!;
  const handle = (await floating.getByLabel('Resize floating panel').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 40, handle.y + handle.height / 2 - 40, {
    steps: 5,
  });
  await page.mouse.up();
  expect((await floating.boundingBox())!.width).toBe(beforeResize.width - 40);
  expect((await floating.boundingBox())!.height).toBe(beforeResize.height - 40);
  await floating.getByRole('button', { name: '关闭 / Close', exact: true }).click();
  await expect(floating).toHaveCount(0);
  await expect(page.getByLabel('Preflight summary')).toContainText('待检查');
  await openDockPanel(page, 'preparation');
  await expect(check).toBeChecked();
  await page.screenshot({ path: 'artifacts/desktop-workspace.png' });
  // Restoring a saved layout must not resurrect a panel floated in another layout.
  await page.getByRole('button', { name: '浮动 赛前准备', exact: true }).click();
  await floating.getByRole('button', { name: '关闭 / Close', exact: true }).click();
  await openWindowMenu(page);
  await page.getByLabel('Workspace name').fill('Closed preparation');
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await openDockPanel(page, 'preparation');
  await page.getByRole('button', { name: '浮动 赛前准备', exact: true }).click();
  await expect(floating).toBeVisible();
  await openWindowMenu(page);
  await page
    .getByLabel('Workspace preset', { exact: true })
    .selectOption('saved:Closed preparation');
  await expect(floating).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.flexlayout__tab_button').filter({ hasText: '赛前准备' })).toHaveCount(
    0,
  );
});
