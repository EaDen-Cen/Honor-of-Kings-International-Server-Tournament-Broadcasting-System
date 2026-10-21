import { test, expect } from './fixtures';
import { harness } from './harness';
import { initialState } from '../src/shared/types';
test('dock presets, saved layout and drag preserve mounted business state', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    await page.goto('/control');
    const search = page.getByRole('textbox', { name: 'Search heroes' });
    await search.fill('test-draft');
    await search.evaluate((el) => el.setAttribute('data-lifetime-probe', 'same-node'));
    for (const preset of ['live', 'postgame', 'bp', 'default'])
      await page.getByLabel('Workspace preset', { exact: true }).selectOption(preset);
    await expect(search).toHaveValue('test-draft');
    await expect(search).toHaveAttribute('data-lifetime-probe', 'same-node');
    await page.getByLabel('Workspace name').fill('My broadcast');
    await page.getByRole('button', { name: 'Save layout', exact: true }).click();
    await expect(page.getByLabel('Workspace preset', { exact: true })).toHaveValue(
      'saved:My broadcast',
    );
    const before = await page.evaluate(() => localStorage.getItem('hok-dock-workspace-v1'));
    const source = page
      .locator('.flexlayout__tab_button')
      .filter({ hasText: 'Draft & recognition' });
    const target = page
      .locator('.flexlayout__tab_button')
      .filter({ hasText: 'Match / BP preview' });
    await source.dragTo(target);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hok-dock-workspace-v1')))
      .not.toBe(before);
    await expect(search).toHaveValue('test-draft');
    await expect(search).toHaveAttribute('data-lifetime-probe', 'same-node');
    await page.getByRole('button', { name: 'Restore default', exact: true }).click();
    await page.getByLabel('Workspace preset', { exact: true }).selectOption('saved:My broadcast');
    await page.reload();
    await expect(page.getByLabel('Workspace preset', { exact: true })).toHaveValue(
      'saved:My broadcast',
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: 'artifacts/dock-workspace-1920.png', fullPage: true });
  } finally {
    h.close();
  }
});
