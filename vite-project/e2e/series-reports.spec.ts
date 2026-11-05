import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';

test('BO5 manual report fields reset for each committed game and all five remain editable', async ({ page, baseURL }) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...h.state(), language: 'eng', seriesFormat: 'BO5' } });
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'postgame');
    await page.getByText('Post-game data and MVP', { exact: true }).click();
    const ids: string[] = [];
    for (let game = 1; game <= 5; game++) {
      await h.fill();
      await h.send({ type: 'commit_game' });
      const report = h.state().postGameReports.at(-1)!;
      ids.push(report.id);
      await expect(page.getByLabel('Post-game report', { exact: true })).toHaveValue(report.id);
      const ratings = page.getByText('Player ratings · manual fallback', { exact: true }).locator('..');
      if (await ratings.getAttribute('open') === null) await ratings.locator('summary').click();
      const input = ratings.getByLabel(`Rating ${report.players[0].rowId}`, { exact: true });
      await expect(input).toHaveValue('');
      await input.fill(String(game));
      await input.press('Tab');
      await expect.poll(() => h.state().postGameReports.at(-1)?.players[0].fields.rating?.value).toBe(game);
      await h.send({ type: 'score', team: game % 2 ? 'blue' : 'red', delta: 1 });
      if (game < 5) {
        await h.send({ type: 'next_game' });
        await expect(page.getByLabel('Post-game report', { exact: true })).toHaveValue('');
        await expect(input).toHaveCount(0);
      }
    }
    await page.reload();
    const panel = page.getByText('Post-game data and MVP', { exact: true }).locator('..');
    if (await panel.getAttribute('open') === null) await panel.locator(':scope > summary').click();
    for (let game = 1; game <= 5; game++) {
      await page.getByLabel('Post-game report', { exact: true }).selectOption(ids[game - 1]);
      const report = h.state().postGameReports[game - 1];
      const ratings = page.getByText('Player ratings · manual fallback', { exact: true }).locator('..');
      if (await ratings.getAttribute('open') === null) await ratings.locator('summary').click();
      await expect(ratings.getByLabel(`Rating ${report.players[0].rowId}`, { exact: true })).toHaveValue(String(game));
    }
  } finally { h.close(); }
});
