import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';

test('custom workspace shortcuts persist, reveal real panels and never trigger while typing', async ({ page, baseURL }) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...h.state(), language: 'eng' } });
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'settings');
    const shortcuts = page.getByLabel('Custom navigation shortcuts', { exact: true });
    await shortcuts.locator('summary').click();
    await shortcuts.getByLabel('Shortcut live-hud-workspace', { exact: true }).fill('Ctrl+Alt+H');
    await shortcuts.getByRole('button', { name: 'Save shortcuts' }).click();
    await expect(shortcuts.getByRole('status')).toHaveText('Shortcuts saved.');
    await page.keyboard.press('Control+Alt+H');
    await expect(page.locator('#live-hud-workspace')).toBeVisible();
    await page.keyboard.press('Control+Alt+5');
    await expect(page.locator('#integration-settings')).toBeVisible();
    await shortcuts.getByLabel('Shortcut live-hud-workspace', { exact: true }).focus();
    await page.keyboard.press('Control+Alt+H');
    await expect(shortcuts.getByLabel('Shortcut live-hud-workspace', { exact: true })).toBeFocused();
    await expect(page.locator('#integration-settings')).toBeVisible();
    await page.reload();
    await openDockPanel(page, 'settings');
    await shortcuts.locator('summary').click();
    await expect(shortcuts.getByLabel('Shortcut live-hud-workspace', { exact: true })).toHaveValue('Ctrl+Alt+H');
  } finally { h.close(); }
});

test('emergency bypass retains failed observations across sessions and never marks a new session checked', async ({ page, baseURL }) => {
  const h = await harness(baseURL);
  await page.route('**/api/v1/obs/status', route => route.fulfill({ json: { connected: false } }));
  await page.route('**/api/v1/obs/storage', route => route.fulfill({ json: { ok: false } }));
  try {
    await h.send({ type: 'settings', settings: { ...h.state(), language: 'eng' } });
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'preparation');
    const checklist = page.getByLabel('Broadcast startup checklist', { exact: true });
    await checklist.locator(':scope > summary').click();
    await expect(checklist.locator('[data-check="Node"]')).toHaveAttribute('data-passed', 'true');
    await expect(checklist.locator('[data-check="OBS"]')).toContainText('unavailable');
    page.once('dialog', dialog => dialog.accept());
    await checklist.getByRole('button', { name: 'Emergency bypass', exact: true }).click();
    const record = await page.evaluate(() => JSON.parse(localStorage.getItem('hok-preflight-bypass-log-v1') || '[]').at(-1));
    expect(record.unchecked).toHaveLength(4);
    expect(record.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'OBS', ok: false })]));
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('about:blank');
    await page.goto('/control#token=e2e-control');
    await expect(checklist.getByRole('status')).toHaveText('Not complete · preflight required');
    await checklist.locator(':scope > summary').click();
    const history = checklist.getByLabel('Emergency bypass history', { exact: true });
    await history.locator('summary').click();
    await expect(history).toContainText('OBS: Unverified / unavailable');
  } finally { h.close(); }
});
