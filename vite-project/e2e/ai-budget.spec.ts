import { test, expect } from './fixtures';
import { openDockPanel } from './dockNavigation';
import { harness } from './harness';

test('AI cost limits default closed and persist without exposing credentials', async ({ page, baseURL, request }) => {
  const h = await harness(baseURL);
  const headers = { Authorization: 'Bearer e2e-control' };
  try {
    await h.send({ type: 'settings', settings: { ...h.state(), language: 'eng' } });
    const initial = await request.get('/api/v1/ai-recognition/budget', { headers });
    expect(initial.ok()).toBeTruthy();
    expect((await initial.json()).limits.dailyUsd).toBe(0);
    expect((await request.put('/api/v1/ai-recognition/budget', { data: {} })).status()).toBe(403);
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'settings');
    const budget = page.getByLabel('AI cost protection', { exact: true });
    await budget.locator('summary').click();
    await budget.getByRole('spinbutton', { name: 'Daily request limit', exact: true }).fill('20');
    await budget.getByRole('spinbutton', { name: 'Daily estimated budget (USD)', exact: true }).fill('0.1');
    await budget.getByRole('spinbutton', { name: 'Conservative estimate per request (USD, cover backup model)', exact: true }).fill('0.01');
    await budget.getByRole('button', { name: 'Save cost protection' }).click();
    await expect.poll(async () => (await (await request.get('/api/v1/ai-recognition/budget', { headers })).json()).limits.dailyCalls).toBe(20);
    await page.reload();
    await openDockPanel(page, 'settings');
    await budget.locator('summary').click();
    await expect(budget.getByRole('spinbutton', { name: 'Daily estimated budget (USD)', exact: true })).toHaveValue('0.1');
    await expect(budget.getByRole('status')).toContainText('Actual invoice: unknown');
    expect((await request.put('/api/v1/ai-recognition/budget', { headers, data: { dailyCalls: -1 } })).status()).toBe(400);
  } finally { h.close(); }
});
