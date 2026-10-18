import { test, expect } from './fixtures';
import { harness } from './harness';

test('settings keep local edits, merge independent remote updates and block conflicting saves', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  try {
    await match.send({ type: 'reset_match' });
    await match.send({ type: 'settings', settings: { ...match.state(), language: 'zh' } });
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    await page.getByRole('button', { name: '比赛设置', exact: true }).click();
    const panel = page.locator('#match-settings');
    await panel.getByLabel('比赛阶段', { exact: true }).fill('Local final');
    await match.send({ type: 'settings', settings: { ...match.state(), overlayLayout: 'side' } });
    await expect(panel.getByLabel('比赛阶段', { exact: true })).toHaveValue('Local final');
    await expect(panel.locator('select').filter({ has: page.locator('option[value="side"]') })).toHaveValue('side');
    await match.send({ type: 'settings', settings: { ...match.state(), stage: 'Remote final' } });
    await expect(panel.getByRole('alert')).toContainText('其他页面更改');
    await expect(panel.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: '重新载入设置', exact: true }).click();
    await expect(panel.getByLabel('比赛阶段', { exact: true })).toHaveValue('Remote final');
    await expect(panel.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
    await panel.getByLabel('比赛阶段', { exact: true }).fill('Saved final');
    await panel.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(panel.locator('[role="status"]')).toHaveText('设置已同步。');
    await expect.poll(() => match.state().stage).toBe('Saved final');
  } finally { match.close(); }
});

test('closing unsaved settings can be cancelled and empty caster delay cannot be submitted', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  try {
    await match.send({ type: 'reset_match' });
    await match.send({ type: 'settings', settings: { ...match.state(), language: 'zh' } });
    await match.send({ type: 'delay', seconds: 42 });
    await page.goto('/control#token=e2e-control');
    await expect(page.getByLabel('解说延迟秒数')).toHaveValue('42');
    await page.getByLabel('解说延迟秒数').fill('');
    await expect(page.getByRole('button', { name: '设置延迟', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '比赛设置', exact: true }).click();
    await page.getByLabel('比赛阶段', { exact: true }).fill('Unsaved');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '收起比赛设置', exact: true }).click();
    await expect(page.getByLabel('比赛阶段', { exact: true })).toHaveValue('Unsaved');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '收起比赛设置', exact: true }).click();
    await expect(page.locator('#match-settings')).toHaveCount(0);
  } finally { match.close(); }
});

test('a failed lazy page load offers reload instead of a blank page', async ({ page }) => {
  await page.route(/\/assets\/BroadcastApp-[^/]+\.js$/, route => route.abort());
  await page.goto('/control#token=e2e-control');
  await expect(page.getByRole('heading', { name: '页面暂时无法显示 / Page unavailable' })).toBeVisible();
  await page.unroute(/\/assets\/BroadcastApp-[^/]+\.js$/);
  await page.getByRole('button', { name: '重新加载 / Reload', exact: true }).click();
  await expect(page.locator('.status')).toHaveText(/已连接|Connected/);
});

test('control remains usable when browser storage is blocked', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  try {
    await match.send({ type: 'settings', settings: { ...match.state(), language: 'zh' } });
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      Storage.prototype.removeItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    });
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    await expect(page.getByLabel('搜索英雄', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '比赛设置', exact: true }).click();
    await expect(page.getByLabel('比赛阶段', { exact: true })).toBeVisible();
  } finally { match.close(); }
});
