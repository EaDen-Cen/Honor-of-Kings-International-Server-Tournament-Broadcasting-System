import { test, expect } from './fixtures';
import { heroesForPool } from '../src/shared/heroPool';
import sharp from 'sharp';

test('simulator pairs labeled crops, reports failures and exports evidence', async ({ page }) => {
  const [a, b] = heroesForPool('global');
  let requests = 0;
  await page.route('**/api/v1/ai-recognition/evaluate', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.expected).toBeUndefined();
    requests++;
    if (requests === 2) return route.fulfill({ status: 409, json: { error: '评测忙碌' } });
    await route.fulfill({
      json: {
        local: { heroId: b.id, confidence: 0.4 },
        assisted: { heroId: a.id, confidence: 0.95 },
        localMs: 10,
        assistedMs: 500,
        outcome: 'ai-used',
        model: 'mock',
        vendor: 'test',
      },
    });
  });
  await page.goto('/tools/bp-simulator-control#token=e2e-control');
  const panel = page.getByRole('region', { name: 'AI 效果对比实验室' });
  await expect(panel.getByRole('button', { name: /开始配对评测/ })).toBeDisabled();
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#456789' },
  })
    .png()
    .toBuffer();
  await panel.locator('input[type=file]').setInputFiles([
    { name: 'clear.png', mimeType: 'image/png', buffer },
    { name: 'small.png', mimeType: 'image/png', buffer },
  ]);
  await panel.getByLabel('正确英雄 1', { exact: true }).selectOption(String(a.id));
  await panel.getByLabel('正确英雄 2', { exact: true }).selectOption(String(a.id));
  await panel.getByRole('button', { name: /开始配对评测/ }).click();
  await expect(panel.getByRole('status')).toContainText('评测完成');
  await expect(panel).toContainText('100.0 个百分点');
  await expect(panel.getByRole('alert')).toContainText('评测忙碌');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出结果 JSON' }).click();
  expect((await download).suggestedFilename()).toBe('ai-evaluation.json');
  await page.screenshot({ path: 'artifacts/ai-evaluation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('button', { name: /开始配对评测/ })).toBeVisible();
  expect(
    await panel.locator('.sim-ai-samples').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'artifacts/ai-evaluation-mobile.png', fullPage: true });
});

test('evaluation endpoint requires local control and validates samples', async ({ request }) => {
  const denied = await request.post('/api/v1/ai-recognition/evaluate', { data: {} });
  expect(denied.status()).toBe(403);
  const invalid = await request.post('/api/v1/ai-recognition/evaluate', {
    headers: { Authorization: 'Bearer e2e-control' },
    data: { image: 'bad', heroPool: 'unknown', shape: 'square' },
  });
  expect(invalid.status()).toBe(400);
});
