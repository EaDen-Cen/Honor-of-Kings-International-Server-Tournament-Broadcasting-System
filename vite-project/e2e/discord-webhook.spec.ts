import { test, expect } from './fixtures';
import { openDockPanel } from './dockNavigation';
import { harness } from './harness';

test('Webhook preview works without Bot and requires deliberate send; score edits invalidate it', async ({ page, baseURL, request }) => {
  const h = await harness(baseURL);
  let sends = 0;
  await page.route('**/api/v1/discord/webhook', route => route.fulfill({ json: { configured: true, notices: [], busy: false } }));
  await page.route('**/api/v1/discord/webhook-send', async route => {
    sends++;
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { configured: true, busy: false, notices: [{ ...body, status: 'sent', createdAt: Date.now(), messageId: '123456789012345679' }] } });
  });
  try {
    expect((await request.get('/api/v1/discord/webhook')).status()).toBe(403);
    const forbidden = await request.post('/api/v1/discord/webhook-preview', { headers: { Authorization: 'Bearer e2e-control', 'X-Forwarded-For': '192.0.2.1' }, data: { kind: 'start' } });
    expect(forbidden.status()).toBe(403);
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'voting');
    const panel = page.getByRole('region', { name: 'Discord Webhook 通知', exact: true });
    await panel.getByRole('button', { name: '生成发送预览' }).click();
    await expect(panel.getByLabel('Webhook 发送预览')).toContainText('Match starting');
    expect(sends).toBe(0);
    await h.send({ type: 'score', team: 'blue', delta: 1 });
    await expect(panel.getByLabel('Webhook 发送预览')).toHaveCount(0);
    await panel.getByRole('button', { name: '生成发送预览' }).click();
    await expect(panel.getByLabel('Webhook 发送预览')).toContainText('1 : 0');
    await panel.getByRole('button', { name: '确认发送到 Discord', exact: true }).click();
    await expect(panel.getByLabel('Webhook 发送日志')).toContainText('sent');
    await expect(panel.getByRole('button', { name: '按原预览重试' })).toBeDisabled();
    expect(sends).toBe(1);
    await panel.getByRole('combobox', { name: '公告类型' }).selectOption('mvp');
    await panel.getByRole('button', { name: '生成发送预览' }).click();
    await expect(panel.getByRole('status')).toContainText('Select and confirm');
  } finally { h.close(); }
});
