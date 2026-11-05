import { test, expect } from './fixtures';
import { harness } from './harness';

test('manual confirmation never turns unavailable OBS or disk checks into a pass', async ({ page, baseURL }) => {
  const h = await harness(baseURL);
  let available = false;
  await page.route('**/api/v1/obs/status', route => route.fulfill({ json: {
    configured: true, connected: available, recording: available, scenes: ['Game'], programScene: 'Game',
  } }));
  await page.route('**/api/v1/obs/storage', route => route.fulfill({ json: available
    ? { ok: true, source: 'obs', directory: 'D:/recordings', freeBytes: 100 * 1024 ** 3, low: false }
    : { ok: false, error: 'OBS unavailable' },
  }));
  await page.route('**/api/v1/obs/layout?*', route => route.fulfill({ json: { sources: [{ enabled: true, width: 1920, height: 1080 }] } }));
  await page.route('**/api/recovery', route => route.fulfill({ json: { backups: [], lastBackup: null } }));
  try {
    await h.send({ type: 'settings', settings: { ...h.state(), language: 'eng' } });
    await page.goto('/control#token=e2e-control');
    const checklist = page.getByLabel('Broadcast startup checklist', { exact: true });
    await checklist.locator(':scope > summary').click();
    const status = checklist.getByRole('region', { name: 'Automatic preflight status' });
    await expect(status.locator('[data-check="Node"]')).toHaveAttribute('data-passed', 'true');
    await expect(status.locator('[data-check="OBS"]')).toHaveAttribute('data-passed', 'false');
    await expect(status.locator('[data-check="Recording disk"]')).toHaveAttribute('data-passed', 'false');
    for (const checkbox of await checklist.getByRole('checkbox').all()) await checkbox.check();
    await checklist.getByRole('button', { name: 'Finish preflight' }).click();
    await expect(status.locator('[data-check="OBS"]')).toHaveAttribute('data-passed', 'false');
    await expect(status.locator('[data-check="Backup"]')).toHaveAttribute('data-passed', 'false');
    available = true;
    await status.getByRole('button', { name: 'Refresh actual status' }).click();
    await expect(status.locator('[data-check="OBS"]')).toHaveAttribute('data-passed', 'true');
    await expect(status.locator('[data-check="Recording disk"]')).toHaveAttribute('data-passed', 'true');
    available = false;
    await page.reload();
    await checklist.locator(':scope > summary').click();
    await expect(status.locator('[data-check="OBS"]')).toHaveAttribute('data-passed', 'false');
    await expect(checklist.getByRole('status')).toHaveText('Confirmed for this game');
  } finally { h.close(); }
});
