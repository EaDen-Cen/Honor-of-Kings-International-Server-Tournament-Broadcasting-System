import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';
test('local maintenance panel previews sizes and saves opt-in retention without changing match state', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    const before = h.state();
    await page.goto('/control');
    await openDockPanel(page, 'settings');
    await page.locator('.flexlayout__tab_button').filter({ hasText: '设置中心' }).dblclick();
    await page.getByText('本地空间与安全清理', { exact: true }).click();
    await page.getByRole('button', { name: '查看空间占用 / 仅预览', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'node_modules', exact: true })).toBeVisible({
      timeout: 20000,
    });
    await page.screenshot({ path: 'artifacts/storage-maintenance.png', fullPage: true });
    await expect(
      page.getByRole('button', { name: '立即清理已预览项目', exact: true }),
    ).toBeDisabled();
    await page.getByLabel('保留天数', { exact: true }).fill('21');
    await page.getByRole('button', { name: '保存清理设置', exact: true }).click();
    await expect(page.getByText('设置已保存，请重新预览。', { exact: true })).toBeVisible();
    expect(h.state()).toEqual(before);
    for (const headers of [
      {},
      { Authorization: 'Bearer e2e-caster' },
      { Authorization: 'Bearer e2e-control', 'X-Forwarded-For': '127.0.0.1' },
    ]) {
      const r = await page.request.post('/api/v1/storage', {
        headers,
        data: { action: 'inspect' },
      });
      expect(r.status()).toBe(403);
    }
  } finally {
    h.close();
  }
});
