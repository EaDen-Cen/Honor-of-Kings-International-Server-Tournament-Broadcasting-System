import { expect, test } from './fixtures';
import { harness } from './harness';
import { initialState } from '../src/shared/types';
import { cnHeroes } from '../src/shared/heroPool';
import heroes from '../src/components/HeroList';

async function startMatch(baseURL: string | undefined, heroPool: 'global' | 'cn' = 'global') {
  const match = await harness(baseURL);
  await match.send({ type: 'reset_match' });
  await match.send({ type: 'settings', settings: { ...initialState(), language: 'eng', heroPool } });
  return match;
}

async function finishMatch(match: Awaited<ReturnType<typeof harness>>) {
  try {
    await match.send({ type: 'reset_match' });
    await match.send({ type: 'settings', settings: initialState() });
  } finally { match.close(); }
}

test('sharing links validate the website address and follow website edits', async ({ page, baseURL }) => {
  const match = await startMatch(baseURL);
  try {
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button', { name: 'Access and website settings', exact: true }).click();
    const panel = page.locator('#access-settings');
    const website = panel.getByLabel('Public website URL (leave blank to use this website)', { exact: true });
    const generate = panel.getByRole('button', { name: 'Generate read-only sharing links', exact: true });
    for (const invalid of ['https://broadcast.example.com/control', 'https://broadcast.example.com/#token=secret', 'https://user:secret@broadcast.example.com']) {
      await website.fill(invalid);
      await expect(website).toHaveAttribute('aria-invalid', 'true');
      await expect(generate).toBeDisabled();
      await expect(panel.getByRole('alert')).toContainText('without page paths');
    }
    await website.fill('https://broadcast.example.com/');
    await generate.click();
    await expect(panel.getByLabel('Caster', { exact: true })).toHaveValue('https://broadcast.example.com/caster#token=e2e-caster');
    await expect(panel.getByLabel('Overlay', { exact: true })).toHaveValue('https://broadcast.example.com/overlay/draft#token=e2e-overlay');
    await expect(panel.getByRole('button', { name: 'Copy link', exact: true })).toHaveCount(2);
    await website.fill('https://replacement.example.com');
    await expect(panel.getByLabel('Caster', { exact: true })).toHaveValue('https://replacement.example.com/caster#token=e2e-caster');
    await website.fill('');
    await expect(panel.getByLabel('Caster', { exact: true })).toHaveValue(`${baseURL}/caster#token=e2e-caster`);
  } finally { await finishMatch(match); }
});

test('access requests block repeat submissions and preserve input after malformed saves', async ({ page, baseURL }) => {
  const match = await startMatch(baseURL);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let releaseSave: () => void = () => {};
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  let reads = 0, saves = 0;
  try {
    await page.goto('/control#token=e2e-control');
    await page.route(url => url.pathname === '/api/access' && !url.search, async route => {
      if (route.request().method() === 'GET') {
        reads++;
        await gate;
        await route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }).catch(() => {});
      } else {
        saves++;
        if (saves === 1) { await saveGate; await route.fulfill({ json: { configured: true } }).catch(() => {}); }
        else await route.fulfill({ json: { configured: true, token: 'e2e-control' } });
      }
    });
    await page.getByRole('button', { name: 'Access and website settings', exact: true }).click();
    const panel = page.locator('#access-settings');
    await panel.getByRole('button', { name: 'Generate read-only sharing links', exact: true }).click();
    await expect.poll(() => reads).toBe(1);
    await expect(panel.getByRole('button', { name: 'Generating…', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Save password', exact: true })).toBeDisabled();
    release();
    await expect(panel.getByRole('alert')).toContainText('rejected');
    await expect(panel.getByRole('button', { name: 'Generate read-only sharing links', exact: true })).toBeEnabled();
    const password = panel.getByLabel('Remote password (8–256 characters)', { exact: true });
    await password.fill('not-a-real-rotation');
    await panel.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect.poll(() => saves).toBe(1);
    await expect(panel.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await panel.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    releaseSave();
    await expect(panel.getByRole('alert')).toContainText('incomplete data');
    await expect(password).toHaveValue('not-a-real-rotation');
    await expect(panel.getByRole('button', { name: 'Save password', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Password saved');
    await expect(password).toHaveValue('');
    expect(reads).toBe(1); expect(saves).toBe(2);
  } finally { release(); releaseSave(); await finishMatch(match); }
});

test('CN-only heroes without full art can save metadata and confirm it from the server', async ({ page, baseURL }) => {
  const match = await startMatch(baseURL, 'cn');
  const hero = cnHeroes.find(item => item.id > 100000 && !item.artLink)!;
  const previous = structuredClone(match.state().heroDataOverrides[String(hero.id)]);
  try {
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button', { name: 'Hero data & artwork', exact: true }).click();
    const editor = page.locator('.hero-art-editor-dialog');
    await editor.getByLabel('Quick hero search', { exact: true }).fill(hero.chineseName);
    await editor.locator('.hero-studio-grid button').filter({ hasText: hero.englishName }).first().click();
    await editor.getByText('Hero data · advanced', { exact: true }).click();
    const name = `CN editor ${hero.id}`;
    await editor.getByLabel('English name', { exact: true }).fill(name);
    await editor.getByRole('button', { name: 'Save hero data', exact: true }).click();
    await expect(editor.locator('.hero-art-editor-controls > [role="status"]')).toHaveText('Changes synced to the server.');
    await expect.poll(() => match.state().heroDataOverrides[String(hero.id)]?.englishName).toBe(name);
    expect(match.state().heroDataOverrides[String(hero.id)]?.artLink).toBeUndefined();
    await expect(editor.locator('.hero-art-editor-controls')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Save artwork adjustment', exact: true })).toBeVisible();
  } finally {
    if (previous) await match.send({ type: 'hero_data_override', heroId: hero.id, override: previous });
    else await match.send({ type: 'reset_hero_data_override', heroId: hero.id });
    await finishMatch(match);
  }
});

test('hero alias typing and artwork drafts survive hero switching', async ({ page, baseURL }) => {
  const match = await startMatch(baseURL);
  const hero = heroes[0], other = heroes[1];
  const previous = structuredClone(match.state().heroDataOverrides[String(hero.id)]);
  try {
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button', { name: 'Hero data & artwork', exact: true }).click();
    const editor = page.locator('.hero-art-editor-dialog');
    const search = editor.getByLabel('Quick hero search', { exact: true });
    await search.fill(hero.englishName);
    await editor.locator('.hero-studio-grid button').filter({ hasText: hero.englishName }).first().click();
    await editor.getByText('Hero data · advanced', { exact: true }).click();
    const aliases = editor.getByLabel('Search aliases');
    await aliases.fill('');
    await aliases.pressSequentially('One, Two，三');
    await expect(aliases).toHaveValue('One, Two，三');
    const crop = editor.locator('.art-editor-crop-controls input[type="range"]').first();
    await crop.focus(); await crop.press('Home'); await crop.press('ArrowRight');
    await search.fill(other.englishName);
    await editor.locator('.hero-studio-grid button').first().click();
    await search.fill(hero.englishName);
    await editor.locator('.hero-studio-grid button').first().click();
    await expect(aliases).toHaveValue('One, Two, 三');
    await expect(crop).toHaveValue('1');
    await expect(editor.locator('.hero-art-editor-header')).toContainText('Unsaved changes');
    await editor.getByRole('button', { name: 'Save hero data', exact: true }).click();
    await expect.poll(() => match.state().heroDataOverrides[String(hero.id)]?.aliases).toEqual(['One', 'Two', '三']);
    await expect(editor.locator('.hero-art-editor-controls > [role="status"]')).toHaveText('Changes synced to the server.');
    await expect(editor.locator('.hero-art-editor-header')).toContainText('Unsaved changes');
  } finally {
    if (previous) await match.send({ type: 'hero_data_override', heroId: hero.id, override: previous });
    else await match.send({ type: 'reset_hero_data_override', heroId: hero.id });
    await finishMatch(match);
  }
});
