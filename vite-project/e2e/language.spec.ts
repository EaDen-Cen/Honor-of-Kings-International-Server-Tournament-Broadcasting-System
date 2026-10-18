import { test, expect, type Page } from './fixtures';
import heroes from '../src/components/HeroList';

const chineseCharacters = /[\u3400-\u9fff]/u;

async function expectEnglishInterface(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect((await page.locator('body').innerText()).replaceAll('蓝方队伍', '').replaceAll('红方队伍', '').replaceAll('社区赛事', '')).not.toMatch(chineseCharacters);
  const visibleLabels = await page.locator('input, select, button, img, [title], [aria-label]').evaluateAll(elements =>
    elements.filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    }).flatMap(element => [
      element.getAttribute('title') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('placeholder') || '',
      element.getAttribute('alt') || '',
      element instanceof HTMLInputElement && element.type === 'text' ? element.value : '',
    ]),
  );
  expect(visibleLabels.filter(label => chineseCharacters.test(label.replaceAll('蓝方队伍', '').replaceAll('红方队伍', '').replaceAll('社区赛事', '')))).toEqual([]);
}

test('language updates all interfaces immediately while draft data follows the caster timeline', async ({ browser, baseURL }) => {
  // Keep all mutations on Playwright's disposable match server.
  expect(baseURL).toBe('http://127.0.0.1:3101');
  const context = await browser.newContext();
  const control = await context.newPage();
  const caster = await context.newPage();
  const overlay = await context.newPage();
  const pageErrors: string[] = [];
  for (const page of [control, caster, overlay]) page.on('pageerror', error => pageErrors.push(error.message));

  await control.goto('/control#token=e2e-control');
  await expect(control.locator('.status')).toHaveText(/^(已连接|Connected)$/);
  control.on('dialog', dialog => dialog.accept());
  await control.getByRole('button', { name: /^(重置整场比赛|Reset match)$/ }).click();
  await expect(control.getByRole('button', { name: '重置整场比赛', exact: true })).toBeEnabled();
  await control.locator('.delay-controls input').fill('180');
  await control.getByRole('button', { name: '设置延迟', exact: true }).click();
  await expect(control.getByRole('button', { name: '设置延迟', exact: true })).toBeEnabled();
  await caster.goto('/caster#token=e2e-caster');
  await overlay.setViewportSize({ width: 1920, height: 1080 });
  await overlay.goto('/overlay/draft#token=e2e-overlay');
  await expect(caster.locator('.status')).toHaveText('已连接');

  await control.getByTitle('澜', { exact: true }).click();
  await expect(overlay.locator('.blue .bans img')).toHaveCount(1);
  await control.getByRole('button', { name: '比赛设置', exact: true }).click();
  await control.getByLabel('界面语言', { exact: true }).selectOption('eng');
  await expect(control.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(control.getByRole('button', { name: '保存设置', exact: true })).toBeVisible();
  await expect(overlay.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await control.getByRole('button', { name: '保存设置', exact: true }).click();

  await expect(control.locator('.status')).toHaveText('Connected');
  await expect(control.getByLabel('Interface language', { exact: true })).toHaveValue('eng');
  await expect(overlay.locator('html')).toHaveAttribute('lang', 'en');
  // Presentation settings are live; only gameplay follows caster delay.
  await expect(caster.locator('html')).toHaveAttribute('lang', 'en');
  await expect(caster.locator('.analysis[data-side="blue"] h2')).toHaveText('蓝方队伍');
  await expect(caster.locator('.blue .bans img')).toHaveCount(0);

  await control.getByRole('button', { name: 'Hide match settings', exact: true }).click();
  await control.locator('.delay-controls input').fill('0');
  await control.getByRole('button', { name: 'Set delay', exact: true }).click();
  await expect(caster.locator('.status')).toHaveText('Connected');
  await expect(caster.locator('.blue .bans img')).toHaveCount(1);
  for (const page of [control, caster]) {
    await expect(page.locator('.analysis[data-side="blue"] .analysis-side')).toHaveText('Blue draft analysis');
    await expect(page.locator('.analysis[data-side="red"] .analysis-side')).toHaveText('Red draft analysis');
    await expect(page.locator('.analysis[data-side="blue"] h2')).toHaveText('蓝方队伍');
    await expect(page.locator('.analysis[data-side="red"] h2')).toHaveText('红方队伍');
  }
  for (const page of [control, caster, overlay]) {
    await expect(page.locator('.blue .bans img')).toHaveAttribute('alt', 'Lam');
    await expectEnglishInterface(page);
  }
  await control.getByRole('button', { name: 'Match settings', exact: true }).click();
  await control.bringToFront(); await control.screenshot({ path: 'artifacts/settings-en.png', fullPage: true });

  // Scores update immediately and saving other settings must not roll them back.
  await control.locator('.score-control').first().getByRole('button', { name: 'Increase series score', exact: true }).click();
  await expect(overlay.locator('.blue-score')).toHaveText('1');
  await control.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(overlay.locator('.blue-score')).toHaveText('1');
  await control.locator('.score-control').first().getByRole('button', { name: 'Decrease series score', exact: true }).click();
  await expect(overlay.locator('.blue-score')).toHaveText('0');
  await control.getByRole('button', { name: 'Hide match settings', exact: true }).click();
  await control.getByLabel('Search heroes', { exact: true }).fill('澜');
  await expect(control.locator('.hero-grid button')).toHaveCount(1);
  await expect(control.locator('.hero-grid button')).toHaveAttribute('title', 'Lam');
  await expect(control.locator('.hero-grid button')).toHaveText('Lam');
  await control.getByLabel('Search heroes', { exact: true }).fill('');
  await control.getByRole('button', { name: 'Jungling', exact: true }).click();
  await expect(control.getByTitle('Feyd', { exact: true })).toBeVisible();
  await expect(control.getByTitle('Haya', { exact: true })).toHaveCount(0);
  await control.getByRole('button', { name: 'All', exact: true }).click();
  await expect(control.locator('.hero-grid button')).toHaveCount(heroes.length);

  for (const page of [control, caster, overlay]) await page.reload();
  for (const page of [control, caster]) await expect(page.locator('.status')).toHaveText('Connected');
  for (const page of [control, caster, overlay]) await expectEnglishInterface(page);
  await control.bringToFront(); await control.screenshot({ path: 'artifacts/control-en.png', fullPage: true });
  await caster.bringToFront(); await caster.screenshot({ path: 'artifacts/caster-en.png', fullPage: true });
  await overlay.bringToFront(); await overlay.screenshot({ path: 'artifacts/overlay-en.png', omitBackground: true });

  // The alternative OBS layout also contains translated team and player defaults.
  await control.getByRole('button', { name: 'Match settings', exact: true }).click();
  const layoutSelect = control.locator('.settings select').filter({ has: control.locator('option[value="side"]') });
  await layoutSelect.selectOption('side');
  await control.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(overlay.locator('.broadcast-side')).toBeVisible();
  await expect(overlay.locator('.card-caption').first()).toContainText('Player 1');
  await expectEnglishInterface(overlay);
  for (const slot of await overlay.locator('.broadcast-card').all()) {
    const box = await slot.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1920);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1080);
  }
  await overlay.bringToFront(); await overlay.screenshot({ path: 'artifacts/overlay-side-en.png', omitBackground: true });

  await layoutSelect.selectOption('panel');
  await control.getByLabel('Interface language', { exact: true }).selectOption('zh');
  await expect(control.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
  await expect(control.locator('html')).toHaveAttribute('lang', 'en');
  await control.getByRole('button', { name: 'Save settings', exact: true }).click();
  for (const page of [control, caster, overlay]) {
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('.blue .bans img')).toHaveAttribute('alt', '澜');
    await expect(page.locator('.blue h2')).toHaveText('蓝方队伍');
    await expect(page.locator('.red h2')).toHaveText('红方队伍');
  }
  await control.getByRole('button', { name: '收起比赛设置', exact: true }).click();
  await expect(control.getByRole('button', { name: '设置延迟', exact: true })).toBeVisible();
  await expect(control.getByLabel('搜索英雄', { exact: true })).toBeVisible();
  await expect(control.getByRole('button', { name: '打野', exact: true })).toBeVisible();
  await expect(control.getByTitle('暃', { exact: true })).toBeVisible();
  await expect(caster.locator('.analysis-side')).toHaveText(['蓝方阵容分析', '红方阵容分析']);
  expect(pageErrors).toEqual([]);
  await context.close();
});
